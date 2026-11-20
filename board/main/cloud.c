// cloud.c — HTTPS(esp_http_client) + Firebase Auth REST + Firestore REST
//
// 로그인 흐름 (아이 기기와 같음)
//   1. accounts:signUp 으로 익명 로그인 → idToken(1시간), refreshToken, uid
//   2. invites/{코드} 를 읽어 familyId 확인 (kind == 'board')
//   3. families/{fid}/members/{uid} = {role:'board', code, joinedAt}, users/{uid} = {familyId}
//   4. refreshToken·uid·fid 를 NVS에 저장 → 다시 켜도 코드를 다시 넣지 않는다
#include "cloud.h"
#include "fs_json.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nvs.h"

static const char *TAG = "cloud";
#define NVS_NS "family"
#define FS_ROOT "https://firestore.googleapis.com/v1/projects/" CONFIG_FAMILY_FIREBASE_PROJECT_ID "/databases/(default)/documents"
#define FS_NAME_PREFIX "projects/" CONFIG_FAMILY_FIREBASE_PROJECT_ID "/databases/(default)/documents/"

static struct {
    char uid[128];
    char fid[128];
    char refresh[1024];
    char id_token[2560];
    int64_t expires_us;      // esp_timer 기준
} s;
static SemaphoreHandle_t s_lock;

// ---------- HTTPS ----------
typedef struct { int status; char *body; size_t len; } resp_t;

static esp_err_t on_http(esp_http_client_event_t *e)
{
    resp_t *r = e->user_data;
    if (e->event_id == HTTP_EVENT_ON_DATA && e->data_len > 0) {
        char *nb = realloc(r->body, r->len + e->data_len + 1);
        if (!nb) return ESP_ERR_NO_MEM;
        memcpy(nb + r->len, e->data, e->data_len);
        r->len += e->data_len;
        nb[r->len] = 0;
        r->body = nb;
    }
    return ESP_OK;
}

static int http(esp_http_client_method_t method, const char *url, const char *bearer,
                const char *ctype, const char *body, resp_t *out)
{
    memset(out, 0, sizeof(*out));
    esp_http_client_config_t cfg = {
        .url = url,
        .event_handler = on_http,
        .user_data = out,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .timeout_ms = 15000,
        .buffer_size = 4096,
        .buffer_size_tx = 8192, // updateMask가 길어도 요청 줄이 들어가게
    };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (!c) return -1;
    esp_http_client_set_method(c, method);
    if (bearer) {
        size_t n = strlen(bearer) + 8;
        char *h = malloc(n);
        snprintf(h, n, "Bearer %s", bearer);
        esp_http_client_set_header(c, "Authorization", h);
        free(h);
    }
    if (body) {
        esp_http_client_set_header(c, "Content-Type", ctype ? ctype : "application/json");
        esp_http_client_set_post_field(c, body, strlen(body));
    }
    esp_err_t err = esp_http_client_perform(c);
    out->status = err == ESP_OK ? esp_http_client_get_status_code(c) : -1;
    if (err != ESP_OK) ESP_LOGW(TAG, "HTTP 실패: %s", esp_err_to_name(err));
    esp_http_client_cleanup(c);
    return out->status;
}

static void resp_free(resp_t *r) { free(r->body); r->body = NULL; r->len = 0; }

// ---------- NVS ----------
static void nvs_save(void)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_str(h, "uid", s.uid);
    nvs_set_str(h, "fid", s.fid);
    nvs_set_str(h, "refresh", s.refresh);
    nvs_commit(h);
    nvs_close(h);
}

static void nvs_load_str(nvs_handle_t h, const char *k, char *buf, size_t n)
{
    size_t len = n;
    if (nvs_get_str(h, k, buf, &len) != ESP_OK) buf[0] = 0;
}

esp_err_t cloud_init(void)
{
    s_lock = xSemaphoreCreateRecursiveMutex();
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) == ESP_OK) {
        nvs_load_str(h, "uid", s.uid, sizeof(s.uid));
        nvs_load_str(h, "fid", s.fid, sizeof(s.fid));
        nvs_load_str(h, "refresh", s.refresh, sizeof(s.refresh));
        nvs_close(h);
    }
    ESP_LOGI(TAG, "로그인 %s, 가족 %s", s.refresh[0] ? "있음" : "없음", s.fid[0] ? s.fid : "(연결 전)");
    return ESP_OK;
}

bool cloud_has_family(void) { return s.fid[0] != 0; }
const char *cloud_family(void) { return s.fid; }

void cloud_forget_family(void)
{
    xSemaphoreTakeRecursive(s_lock, portMAX_DELAY);
    s.fid[0] = 0;
    nvs_save();
    xSemaphoreGiveRecursive(s_lock);
}

// ---------- Firebase Auth ----------
static bool take_tokens(const char *body, const char *id_key, const char *refresh_key, const char *exp_key, const char *uid_key)
{
    cJSON *j = cJSON_Parse(body ? body : "");
    const cJSON *id = cJSON_GetObjectItem(j, id_key), *rf = cJSON_GetObjectItem(j, refresh_key);
    const cJSON *ex = cJSON_GetObjectItem(j, exp_key), *uid = cJSON_GetObjectItem(j, uid_key);
    bool ok = cJSON_IsString(id) && cJSON_IsString(rf);
    if (ok) {
        snprintf(s.id_token, sizeof(s.id_token), "%s", id->valuestring);
        snprintf(s.refresh, sizeof(s.refresh), "%s", rf->valuestring);
        if (cJSON_IsString(uid)) snprintf(s.uid, sizeof(s.uid), "%s", uid->valuestring);
        int secs = cJSON_IsString(ex) ? atoi(ex->valuestring) : 3600;
        s.expires_us = esp_timer_get_time() + (int64_t)(secs - 300) * 1000000; // 5분 일찍 갱신
        nvs_save();
    }
    cJSON_Delete(j);
    return ok;
}

static bool sign_up(void)
{
    resp_t r;
    http(HTTP_METHOD_POST, "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" CONFIG_FAMILY_FIREBASE_API_KEY,
         NULL, "application/json", "{\"returnSecureToken\":true}", &r);
    bool ok = r.status == 200 && take_tokens(r.body, "idToken", "refreshToken", "expiresIn", "localId");
    if (!ok) ESP_LOGE(TAG, "익명 로그인 실패 %d: %.200s", r.status, r.body ? r.body : "");
    else { s.fid[0] = 0; nvs_save(); ESP_LOGI(TAG, "새 익명 로그인 uid=%s", s.uid); }
    resp_free(&r);
    return ok;
}

static bool refresh(void)
{
    char *form = malloc(strlen(s.refresh) + 64);
    sprintf(form, "grant_type=refresh_token&refresh_token=%s", s.refresh);
    resp_t r;
    http(HTTP_METHOD_POST, "https://securetoken.googleapis.com/v1/token?key=" CONFIG_FAMILY_FIREBASE_API_KEY,
         NULL, "application/x-www-form-urlencoded", form, &r);
    free(form);
    bool ok = r.status == 200 && take_tokens(r.body, "id_token", "refresh_token", "expires_in", "user_id");
    if (!ok) {
        ESP_LOGW(TAG, "토큰 갱신 실패 %d", r.status);
        if (r.status == 400) { s.refresh[0] = 0; s.fid[0] = 0; nvs_save(); } // 계정이 사라짐 → 처음부터
    }
    resp_free(&r);
    return ok;
}

// 쓸 수 있는 idToken을 준비한다
static bool ensure_token(bool force)
{
    if (!s.refresh[0]) return sign_up();
    if (!force && s.id_token[0] && esp_timer_get_time() < s.expires_us) return true;
    return refresh();
}

// 토큰을 붙여 요청하고, 401이면 한 번 갱신해서 다시 보낸다
static int authed(esp_http_client_method_t m, const char *url, const char *body, resp_t *out)
{
    xSemaphoreTakeRecursive(s_lock, portMAX_DELAY);
    int st = -1;
    if (ensure_token(false)) {
        st = http(m, url, s.id_token, "application/json", body, out);
        if (st == 401) {
            resp_free(out);
            if (ensure_token(true)) st = http(m, url, s.id_token, "application/json", body, out);
        }
    }
    xSemaphoreGiveRecursive(s_lock);
    return st;
}

// ---------- Firestore ----------
static char *doc_url(const char *rel, const char *query)
{
    size_t n = strlen(FS_ROOT) + strlen(rel) + (query ? strlen(query) : 0) + 8;
    char *u = malloc(n);
    snprintf(u, n, "%s/%s%s%s", FS_ROOT, rel, query && query[0] ? "?" : "", query ? query : "");
    return u;
}

int cloud_get(const char *rel, const char *query, cJSON **plain_out)
{
    *plain_out = NULL;
    char *url = doc_url(rel, query);
    resp_t r;
    int st = authed(HTTP_METHOD_GET, url, NULL, &r);
    free(url);
    if (st == 200) {
        cJSON *j = cJSON_Parse(r.body);
        *plain_out = fs_fields_to_json(cJSON_GetObjectItem(j, "fields"));
        cJSON_Delete(j);
    }
    resp_free(&r);
    return st;
}

int cloud_batch_get(const char *const *rels, int n, cJSON **out)
{
    cJSON *req = cJSON_CreateObject();
    cJSON *docs = cJSON_AddArrayToObject(req, "documents");
    char name[256];
    for (int i = 0; i < n; i++) {
        out[i] = NULL;
        snprintf(name, sizeof(name), FS_NAME_PREFIX "%s", rels[i]);
        cJSON_AddItemToArray(docs, cJSON_CreateString(name));
    }
    char *body = cJSON_PrintUnformatted(req);
    cJSON_Delete(req);
    resp_t r;
    int st = authed(HTTP_METHOD_POST, FS_ROOT ":batchGet", body, &r);
    free(body);
    if (st == 200) {
        cJSON *arr = cJSON_Parse(r.body), *e;
        cJSON_ArrayForEach(e, arr) {
            const cJSON *found = cJSON_GetObjectItem(e, "found");
            const cJSON *nm = cJSON_GetObjectItem(found, "name");
            if (!cJSON_IsString(nm)) continue;
            for (int i = 0; i < n; i++) {
                snprintf(name, sizeof(name), FS_NAME_PREFIX "%s", rels[i]);
                if (!strcmp(name, nm->valuestring)) { cJSON_Delete(out[i]); out[i] = fs_fields_to_json(cJSON_GetObjectItem(found, "fields")); }
            }
        }
        cJSON_Delete(arr);
    }
    resp_free(&r);
    return st;
}

int cloud_patch(const char *rel, const char *query, const cJSON *body)
{
    char *url = doc_url(rel, query);
    char *b = cJSON_PrintUnformatted(body);
    resp_t r;
    int st = authed(HTTP_METHOD_PATCH, url, b, &r);
    if (st != 200) ESP_LOGW(TAG, "PATCH %s → %d %.200s", rel, st, r.body ? r.body : "");
    free(url);
    free(b);
    resp_free(&r);
    return st;
}

// ---------- 보드 초대 코드로 가족 연결 ----------
static void str_field(cJSON *fields, const char *k, const char *v)
{
    cJSON *x = cJSON_AddObjectToObject(fields, k);
    cJSON_AddStringToObject(x, "stringValue", v);
}

int cloud_join(const char *raw, char *msg, size_t msg_len)
{
    char code[16] = {0};
    int n = 0;
    for (const char *p = raw; *p && n < 8; p++) {
        char c = *p;
        if (c >= 'a' && c <= 'z') c -= 32;
        if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) code[n++] = c;
    }
    if (n != 8) { snprintf(msg, msg_len, "초대 코드 8자리를 확인해 주세요."); return 1; }

    xSemaphoreTakeRecursive(s_lock, portMAX_DELAY);
    int ret = 1;
    char rel[160];
    snprintf(rel, sizeof(rel), "invites/%s", code);
    cJSON *inv = NULL;
    int st = cloud_get(rel, NULL, &inv);
    const char *fid = inv ? cJSON_GetStringValue(cJSON_GetObjectItem(inv, "familyId")) : NULL;
    const char *kind = inv ? cJSON_GetStringValue(cJSON_GetObjectItem(inv, "kind")) : NULL;
    if (st == 404 || (st == 200 && !fid)) snprintf(msg, msg_len, "없는 초대 코드예요. 부모님 기기에서 새 코드를 만들어 주세요.");
    else if (st != 200) snprintf(msg, msg_len, "연결하지 못했어요 (%d). 인터넷을 확인해 주세요.", st);
    else if (!kind || strcmp(kind, "board")) snprintf(msg, msg_len, "아이 기기용 코드예요. 가족 연결 탭에서 \"보드 초대 코드\"를 만들어 주세요.");
    else {
        struct timeval tv;
        gettimeofday(&tv, NULL);
        char ms[24];
        snprintf(ms, sizeof(ms), "%lld", (long long)tv.tv_sec * 1000 + tv.tv_usec / 1000);

        cJSON *body = cJSON_CreateObject(), *fields = cJSON_AddObjectToObject(body, "fields");
        str_field(fields, "role", "board");
        str_field(fields, "code", code);
        cJSON *ja = cJSON_AddObjectToObject(fields, "joinedAt");
        cJSON_AddStringToObject(ja, "integerValue", ms);
        snprintf(rel, sizeof(rel), "families/%s/members/%s", fid, s.uid);
        st = cloud_patch(rel, "currentDocument.exists=false", body);
        cJSON_Delete(body);
        if (st == 200) {
            body = cJSON_CreateObject();
            fields = cJSON_AddObjectToObject(body, "fields");
            str_field(fields, "familyId", fid);
            snprintf(rel, sizeof(rel), "users/%s", s.uid);
            cloud_patch(rel, NULL, body);
            cJSON_Delete(body);
            snprintf(s.fid, sizeof(s.fid), "%s", fid);
            nvs_save();
            snprintf(msg, msg_len, "연결했어요!");
            ret = 0;
        } else if (st == 403) {
            snprintf(msg, msg_len, "시간이 지났거나 쓸 수 없는 코드예요. 새 코드를 만들어 주세요.");
        } else {
            snprintf(msg, msg_len, "연결하지 못했어요 (%d).", st);
        }
    }
    cJSON_Delete(inv);
    xSemaphoreGiveRecursive(s_lock);
    return ret;
}
