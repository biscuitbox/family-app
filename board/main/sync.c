// sync.c — 읽기(batchGet)와 쓰기(PATCH 줄)를 맡는 작업 하나
//
// 읽는 간격 (설계 문서 4장)
//   등교 준비 · 내일 준비 · 15시 이후 · 주말 낮: 10초
//   학교에 있는 시간(평일 08:40~15:00) · 밤: 2분
//   설정(state/config): 5분마다, 통계(stats): 읽기 6번에 1번
#include "sync.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include "cloud.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "model.h"
#include "net.h"

static const char *TAG = "sync";
// tools/make_defaults.mjs가 만든 앱 기본값 (EMBED_TXTFILES라 끝에 0이 붙어 있음)
extern const uint8_t defaults_json_start[] asm("_binary_config_defaults_json_start");
#define PENDING_MAX 32
#define FAST_US (10LL * 1000000)
#define SLOW_US (120LL * 1000000)
#define CONFIG_US (300LL * 1000000)

static board_state_t st;
static SemaphoreHandle_t s_mutex;
static TaskHandle_t s_task;
static log_patch_t *s_pending[PENDING_MAX];
static int s_n_pending;
static char s_join_code[16];
static uint32_t s_hash;

// 보드가 쓰는 설정 칸만 받는다 (보상·생활 기술·AI 설정 같은 큰 칸은 빼고)
static const char *CONFIG_MASK =
    "mask.fieldPaths=kids&mask.fieldPaths=times&mask.fieldPaths=schoolDays&mask.fieldPaths=routines"
    "&mask.fieldPaths=timetable&mask.fieldPaths=dateSupplies&mask.fieldPaths=vacation&mask.fieldPaths=chores"
    "&mask.fieldPaths=adults&mask.fieldPaths=mascot&mask.fieldPaths=weeklyCap&mask.fieldPaths=deviceRule";

board_state_t *sync_lock(void) { xSemaphoreTake(s_mutex, portMAX_DELAY); return &st; }
void sync_unlock(void) { xSemaphoreGive(s_mutex); }
void sync_kick(void) { if (s_task) xTaskNotifyGive(s_task); }

int sync_kid_index(const board_state_t *b, const char *kid_id)
{
    for (int i = 0; i < b->n_kids; i++) if (!strcmp(b->kid_ids[i], kid_id)) return i;
    return -1;
}

static void today_key(char out[11])
{
    time_t now = time(NULL);
    struct tm t;
    localtime_r(&now, &t);
    date_key(&t, out);
}

void sync_submit(const log_patch_t *p)
{
    if (!p || !p->n) return;
    sync_lock();
    int k = sync_kid_index(&st, p->who);
    if (k >= 0 && !strcmp(p->date, st.date)) {
        patch_apply(st.logs[k], p); // 화면에 먼저
        st.version++;
    }
    if (s_n_pending < PENDING_MAX) s_pending[s_n_pending++] = patch_clone(p);
    else ESP_LOGE(TAG, "보내기 줄이 가득 참");
    st.pending = s_n_pending;
    sync_unlock();
    sync_kick();
}

void sync_request_join(const char *code)
{
    sync_lock();
    snprintf(s_join_code, sizeof(s_join_code), "%s", code);
    st.joining = true;
    snprintf(st.join_msg, sizeof(st.join_msg), "연결하는 중…");
    st.version++;
    sync_unlock();
    sync_kick();
}

static uint32_t fnv(const char *s, uint32_t h)
{
    for (; s && *s; s++) { h ^= (unsigned char)*s; h *= 16777619u; }
    return h;
}

// ---------- 설정 ----------
static void set_kids_from_config(void)
{
    st.n_kids = 0;
    const cJSON *k;
    cJSON_ArrayForEach(k, cJSON_GetObjectItem(st.cfg, "kids")) {
        if (st.n_kids >= BOARD_MAX_KIDS) break;
        snprintf(st.kid_ids[st.n_kids], sizeof(st.kid_ids[0]), "%s", jstr(k, "id", ""));
        if (!st.logs[st.n_kids]) st.logs[st.n_kids] = cJSON_CreateObject();
        st.n_kids++;
    }
}

static int fetch_config(void)
{
    char rel[200];
    snprintf(rel, sizeof(rel), "families/%s/state/config", cloud_family());
    cJSON *cfg = NULL;
    int code = cloud_get(rel, CONFIG_MASK, &cfg);
    if (code == 200 && cfg) {
        normalize_config(cfg, (const char *)defaults_json_start); // 앱처럼 빈 칸을 기본값으로
        sync_lock();
        cJSON_Delete(st.cfg);
        st.cfg = cfg;
        set_kids_from_config();
        st.version++;
        sync_unlock();
        ESP_LOGI(TAG, "설정을 받았어요 (아이 %d명)", st.n_kids);
    } else {
        cJSON_Delete(cfg);
    }
    return code;
}

// ---------- 오늘 기록 ----------
static int fetch_today(bool with_stats)
{
    char date[11];
    today_key(date);
    sync_lock();
    int nk = st.n_kids;
    char kids[BOARD_MAX_KIDS][24];
    memcpy(kids, st.kid_ids, sizeof(kids));
    const cJSON *adults = cJSON_GetObjectItem(st.cfg, "adults");
    char adult[24];
    snprintf(adult, sizeof(adult), "%s", jstr(cJSON_GetArrayItem(adults, 0), "id", "dad"));
    sync_unlock();

    static char paths[BOARD_MAX_KIDS * 2 + 1][200];
    const char *rels[BOARD_MAX_KIDS * 2 + 1];
    int n = 0;
    for (int i = 0; i < nk; i++) snprintf(paths[n], sizeof(paths[0]), "families/%s/logs/%s_%s", cloud_family(), date, kids[i]), rels[n] = paths[n], n++;
    snprintf(paths[n], sizeof(paths[0]), "families/%s/logs/%s_%s", cloud_family(), date, adult), rels[n] = paths[n], n++;
    if (with_stats)
        for (int i = 0; i < nk; i++) snprintf(paths[n], sizeof(paths[0]), "families/%s/stats/%s", cloud_family(), kids[i]), rels[n] = paths[n], n++;

    cJSON *out[BOARD_MAX_KIDS * 2 + 1] = {0};
    int code = cloud_batch_get(rels, n, out);
    if (code != 200) { for (int i = 0; i < n; i++) cJSON_Delete(out[i]); return code; }

    sync_lock();
    if (st.n_kids == nk) {
        snprintf(st.date, sizeof(st.date), "%s", date);
        uint32_t h = 2166136261u;
        for (int i = 0; i < nk; i++) {
            cJSON_Delete(st.logs[i]);
            st.logs[i] = out[i] ? out[i] : cJSON_CreateObject();
            out[i] = NULL;
            // 아직 못 보낸 체크는 받은 기록 위에 다시 얹는다 (화면이 깜빡이지 않게)
            for (int p = 0; p < s_n_pending; p++)
                if (!strcmp(s_pending[p]->who, kids[i]) && !strcmp(s_pending[p]->date, date)) patch_apply(st.logs[i], s_pending[p]);
            char *txt = cJSON_PrintUnformatted(st.logs[i]);
            h = fnv(txt, h);
            free(txt);
        }
        cJSON_Delete(st.adult_log);
        st.adult_log = out[nk] ? out[nk] : cJSON_CreateObject();
        out[nk] = NULL;
        char *txt = cJSON_PrintUnformatted(st.adult_log);
        h = fnv(txt, h);
        free(txt);
        if (with_stats)
            for (int i = 0; i < nk; i++) {
                cJSON_Delete(st.stats[i]);
                st.stats[i] = out[nk + 1 + i];
                out[nk + 1 + i] = NULL;
            }
        for (int i = 0; i < nk; i++) { char *t = st.stats[i] ? cJSON_PrintUnformatted(st.stats[i]) : NULL; h = fnv(t, h); free(t); }
        if (h != s_hash) { s_hash = h; st.version++; }
        st.last_ok_us = esp_timer_get_time();
    }
    sync_unlock();
    for (int i = 0; i < n; i++) cJSON_Delete(out[i]);
    return code;
}

// ---------- 보내기 줄 ----------
static void flush_writes(void)
{
    for (;;) {
        sync_lock();
        log_patch_t *p = s_n_pending ? s_pending[0] : NULL;
        sync_unlock();
        if (!p) return;

        char rel[200];
        snprintf(rel, sizeof(rel), "families/%s/logs/%s_%s", cloud_family(), p->date, p->who);
        char *q = malloc(4096);
        patch_mask_query(p, q, 4096);
        cJSON *body = patch_body(p);
        int code = cloud_patch(rel, q, body);
        cJSON_Delete(body);
        free(q);

        if (code == 200 || (code >= 400 && code < 500 && code != 401 && code != 429)) {
            // 성공했거나, 다시 보내도 안 되는 요청(규칙 거부 등)은 줄에서 뺀다
            if (code != 200) ESP_LOGE(TAG, "보내지 못하고 버림 (%d): %s", code, rel);
            sync_lock();
            patch_free(s_pending[0]);
            free(s_pending[0]);
            memmove(s_pending, s_pending + 1, sizeof(s_pending[0]) * (--s_n_pending));
            st.pending = s_n_pending;
            st.last_status = code;
            st.version++;
            sync_unlock();
        } else {
            sync_lock(); st.last_status = code; sync_unlock();
            return; // 연결이 돌아오면 다시
        }
    }
}

// ---------- 간격 ----------
static int64_t poll_interval_us(void)
{
    time_t now = time(NULL);
    struct tm t;
    localtime_r(&now, &t);
    sync_lock();
    const cJSON *cfg = st.cfg;
    bool fast = true;
    if (cfg) {
        app_mode_t m = auto_mode(cfg, &t);
        int mm = t.tm_hour * 60 + t.tm_min;
        bool weekend = !is_school_day(cfg, &t);
        if (m == MODE_REST) {
            if (is_night(cfg, &t)) fast = false;
            else if (!weekend && mm >= 8 * 60 + 40 && mm < 15 * 60) fast = false;
        }
    }
    sync_unlock();
    return fast ? FAST_US : SLOW_US;
}

static void sync_task(void *arg)
{
    int64_t last_poll = 0, last_cfg = 0;
    int polls = 0;
    for (;;) {
        bool kicked = ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(1000)) > 0;
        if (!net_up() || !net_time_ok()) continue;

        // 1. 가족에 아직 연결되지 않았으면 초대 코드를 기다린다
        if (!cloud_has_family()) {
            sync_lock();
            st.need_join = true;
            char code[16];
            snprintf(code, sizeof(code), "%s", s_join_code);
            s_join_code[0] = 0;
            sync_unlock();
            if (code[0]) {
                char msg[320];
                int r = cloud_join(code, msg, sizeof(msg));
                sync_lock();
                st.joining = false;
                snprintf(st.join_msg, sizeof(st.join_msg), "%s", msg);
                if (r == 0) st.need_join = false;
                st.version++;
                sync_unlock();
                last_cfg = 0;
            }
            continue;
        }
        if (st.need_join) { sync_lock(); st.need_join = false; st.version++; sync_unlock(); }

        int64_t now = esp_timer_get_time();
        // 2. 설정
        if (!st.cfg || !last_cfg || now - last_cfg > CONFIG_US) {
            int c = fetch_config();
            if (c == 403 || c == 404) {
                ESP_LOGW(TAG, "가족 공간을 읽을 수 없어요 (%d) — 연결이 해제됨", c);
                cloud_forget_family();
                continue;
            }
            if (c == 200) last_cfg = now;
        }
        if (!st.cfg) continue;

        // 3. 누른 것 보내기
        flush_writes();

        // 4. 오늘 기록 (방금 보냈거나 날짜가 바뀌었으면 바로)
        char today[11];
        today_key(today);
        bool day_changed = strcmp(today, st.date) != 0;
        if (kicked || day_changed || now - last_poll >= poll_interval_us()) {
            int c = fetch_today(polls % 6 == 0);
            polls++;
            if (c == 403) { cloud_forget_family(); continue; }
            last_poll = now;
        }
    }
}

void sync_start(void)
{
    s_mutex = xSemaphoreCreateMutex();
    memset(&st, 0, sizeof(st));
    st.need_join = !cloud_has_family();
    xTaskCreatePinnedToCore(sync_task, "sync", 12288, NULL, 5, &s_task, 0);
}
