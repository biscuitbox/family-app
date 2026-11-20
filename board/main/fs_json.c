// fs_json.c — Firestore REST 값 변환과 하루 기록 patch
#include "fs_json.h"
#include "ikey.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ---------- Firestore 값 ↔ 보통 JSON ----------
cJSON *fs_value_to_json(const cJSON *v)
{
    if (!v) return cJSON_CreateNull();
    const cJSON *x;
    if ((x = cJSON_GetObjectItemCaseSensitive(v, "stringValue"))) return cJSON_CreateString(x->valuestring ? x->valuestring : "");
    if ((x = cJSON_GetObjectItemCaseSensitive(v, "integerValue"))) {
        // 정수는 문자열로 온다. 밀리초 시각(약 1.8e12)도 double에 정확히 들어간다.
        double d = cJSON_IsString(x) ? strtod(x->valuestring, NULL) : x->valuedouble;
        return cJSON_CreateNumber(d);
    }
    if ((x = cJSON_GetObjectItemCaseSensitive(v, "doubleValue"))) return cJSON_CreateNumber(cJSON_IsString(x) ? strtod(x->valuestring, NULL) : x->valuedouble);
    if ((x = cJSON_GetObjectItemCaseSensitive(v, "booleanValue"))) return cJSON_CreateBool(cJSON_IsTrue(x));
    if ((x = cJSON_GetObjectItemCaseSensitive(v, "timestampValue"))) return cJSON_CreateString(x->valuestring ? x->valuestring : "");
    if ((x = cJSON_GetObjectItemCaseSensitive(v, "mapValue"))) return fs_fields_to_json(cJSON_GetObjectItemCaseSensitive(x, "fields"));
    if ((x = cJSON_GetObjectItemCaseSensitive(v, "arrayValue"))) {
        cJSON *arr = cJSON_CreateArray();
        const cJSON *e;
        cJSON_ArrayForEach(e, cJSON_GetObjectItemCaseSensitive(x, "values")) cJSON_AddItemToArray(arr, fs_value_to_json(e));
        return arr;
    }
    return cJSON_CreateNull(); // nullValue 등
}

cJSON *fs_fields_to_json(const cJSON *fields)
{
    cJSON *o = cJSON_CreateObject();
    const cJSON *f;
    cJSON_ArrayForEach(f, fields) cJSON_AddItemToObject(o, f->string, fs_value_to_json(f));
    return o;
}

cJSON *json_to_fs_value(const cJSON *j)
{
    cJSON *v = cJSON_CreateObject();
    if (!j || cJSON_IsNull(j)) { cJSON_AddNullToObject(v, "nullValue"); return v; }
    if (cJSON_IsBool(j)) { cJSON_AddBoolToObject(v, "booleanValue", cJSON_IsTrue(j)); return v; }
    if (cJSON_IsString(j)) { cJSON_AddStringToObject(v, "stringValue", j->valuestring); return v; }
    if (cJSON_IsNumber(j)) {
        double d = j->valuedouble;
        if (d == floor(d) && fabs(d) < 9.0e15) {
            char buf[32];
            snprintf(buf, sizeof(buf), "%.0f", d);
            cJSON_AddStringToObject(v, "integerValue", buf);
        } else {
            cJSON_AddNumberToObject(v, "doubleValue", d);
        }
        return v;
    }
    if (cJSON_IsArray(j)) {
        cJSON *av = cJSON_AddObjectToObject(v, "arrayValue");
        cJSON *vals = cJSON_AddArrayToObject(av, "values");
        const cJSON *e;
        cJSON_ArrayForEach(e, j) cJSON_AddItemToArray(vals, json_to_fs_value(e));
        return v;
    }
    cJSON *mv = cJSON_AddObjectToObject(v, "mapValue");
    cJSON *fields = cJSON_AddObjectToObject(mv, "fields");
    const cJSON *e;
    cJSON_ArrayForEach(e, j) cJSON_AddItemToObject(fields, e->string, json_to_fs_value(e));
    return v;
}

// ---------- patch ----------
void patch_init(log_patch_t *p, const char *date, const char *who)
{
    memset(p, 0, sizeof(*p));
    snprintf(p->date, sizeof(p->date), "%s", date);
    snprintf(p->who, sizeof(p->who), "%s", who);
}

static patch_op_t *op_for(log_patch_t *p, const char *path)
{
    for (int i = 0; i < p->n; i++)
        if (!strcmp(p->ops[i].path, path)) { cJSON_Delete(p->ops[i].value); p->ops[i].value = NULL; return &p->ops[i]; }
    if (p->n >= PATCH_MAX_OPS) return NULL;
    patch_op_t *o = &p->ops[p->n++];
    snprintf(o->path, sizeof(o->path), "%s", path);
    o->value = NULL;
    return o;
}

void patch_set_json(log_patch_t *p, const char *path, cJSON *owned)
{
    patch_op_t *o = op_for(p, path);
    if (o) o->value = owned; else cJSON_Delete(owned);
}
void patch_set_num(log_patch_t *p, const char *path, double v) { patch_set_json(p, path, cJSON_CreateNumber(v)); }
void patch_set_bool(log_patch_t *p, const char *path, bool v) { patch_set_json(p, path, cJSON_CreateBool(v)); }
void patch_del(log_patch_t *p, const char *path) { op_for(p, path); }

void patch_free(log_patch_t *p)
{
    for (int i = 0; i < p->n; i++) { cJSON_Delete(p->ops[i].value); p->ops[i].value = NULL; }
    p->n = 0;
}

log_patch_t *patch_clone(const log_patch_t *p)
{
    log_patch_t *c = malloc(sizeof(*c));
    if (!c) return NULL;
    *c = *p;
    for (int i = 0; i < c->n; i++) c->ops[i].value = p->ops[i].value ? cJSON_Duplicate(p->ops[i].value, 1) : NULL;
    return c;
}

// 경로대로 내려가며 중간 객체를 만든다 (app 쪽 store.js applyPath와 같음)
static void apply_path(cJSON *obj, const char *path, const cJSON *val)
{
    char buf[160];
    snprintf(buf, sizeof(buf), "%s", path);
    cJSON *o = obj;
    char *seg = buf, *dot;
    while ((dot = strchr(seg, '.'))) {
        *dot = 0;
        cJSON *next = cJSON_GetObjectItemCaseSensitive(o, seg);
        if (!next || !cJSON_IsObject(next)) {
            if (next) cJSON_DeleteItemFromObjectCaseSensitive(o, seg);
            next = cJSON_AddObjectToObject(o, seg);
        }
        o = next;
        seg = dot + 1;
    }
    cJSON_DeleteItemFromObjectCaseSensitive(o, seg);
    if (val) cJSON_AddItemToObject(o, seg, cJSON_Duplicate(val, 1));
}

void patch_apply(cJSON *log, const log_patch_t *p)
{
    if (!log) return;
    if (!cJSON_GetObjectItemCaseSensitive(log, "date")) cJSON_AddStringToObject(log, "date", p->date);
    if (!cJSON_GetObjectItemCaseSensitive(log, "kidId")) cJSON_AddStringToObject(log, "kidId", p->who);
    for (int i = 0; i < p->n; i++) apply_path(log, p->ops[i].path, p->ops[i].value);
}

cJSON *patch_body(const log_patch_t *p)
{
    cJSON *plain = cJSON_CreateObject();
    cJSON_AddStringToObject(plain, "date", p->date);
    cJSON_AddStringToObject(plain, "kidId", p->who);
    // 지우는 경로는 본문에서 빼고 updateMask에만 둔다 → Firestore가 그 칸을 지운다
    for (int i = 0; i < p->n; i++) if (p->ops[i].value) apply_path(plain, p->ops[i].path, p->ops[i].value);
    cJSON *fields = json_to_fs_value(plain); // {"mapValue":{"fields":{...}}}
    cJSON_Delete(plain);
    cJSON *mv = cJSON_DetachItemFromObjectCaseSensitive(fields, "mapValue");
    cJSON_Delete(fields);
    cJSON *f = cJSON_DetachItemFromObjectCaseSensitive(mv, "fields");
    cJSON_Delete(mv);
    cJSON *body = cJSON_CreateObject();
    cJSON_AddItemToObject(body, "fields", f);
    return body;
}

// 경로의 마디마다 백틱으로 감싼다: 단계ID가 숫자로 시작해도 안전하다. 백틱은 %60으로 적는다.
size_t patch_mask_query(const log_patch_t *p, char *out, size_t n)
{
    size_t o = snprintf(out, n, "updateMask.fieldPaths=date&updateMask.fieldPaths=kidId");
    for (int i = 0; i < p->n && o < n; i++) {
        o += snprintf(out + o, n - o, "&updateMask.fieldPaths=");
        const char *s = p->ops[i].path;
        bool start = true;
        for (; *s && o + 8 < n; s++) {
            if (start) { o += snprintf(out + o, n - o, "%%60"); start = false; }
            if (*s == '.') { o += snprintf(out + o, n - o, "%%60."); start = true; continue; }
            unsigned char c = (unsigned char)*s;
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-')
                out[o++] = (char)c;
            else
                o += snprintf(out + o, n - o, "%%%02X", c);
        }
        if (o + 4 < n) o += snprintf(out + o, n - o, "%%60");
    }
    if (o >= n) o = n - 1;
    out[o] = 0;
    return o;
}

// ---------- 보드에서 누른 것 ----------
static void path3(char *buf, size_t n, const char *a, const char *b, const char *c)
{
    snprintf(buf, n, "%s.%s.%s", a, b, c);
}

// 고칠 내용을 적용한 기록으로 "모든 단계가 끝났는지" 다시 보고 completedAt을 맞춘다 — app.js settle()
static void settle(const cJSON *cfg, const cJSON *log, const char *kid, app_mode_t mode, const struct tm *t,
                   int64_t now_ms, log_patch_t *p)
{
    cJSON *after = log ? cJSON_Duplicate(log, 1) : cJSON_CreateObject();
    patch_apply(after, p);
    static rt_step_t steps[RT_MAX_STEPS];
    int n = routine_steps(cfg, kid, mode, t, steps, RT_MAX_STEPS);
    bool all = n > 0;
    for (int i = 0; i < n; i++) if (!step_done(after, mode, steps[i].id)) all = false;
    double done_at = completed_at(after, mode);
    char path[64];
    snprintf(path, sizeof(path), "%s.completedAt", mode_key(mode));
    if (all && !done_at) patch_set_num(p, path, (double)now_ms);
    else if (!all && done_at) patch_del(p, path);
    cJSON_Delete(after);
}

static const rt_step_t *find_step(const rt_step_t *steps, int n, const char *id)
{
    for (int i = 0; i < n; i++) if (!strcmp(steps[i].id, id)) return &steps[i];
    return NULL;
}

void act_step(const cJSON *cfg, const cJSON *log, const char *kid, app_mode_t mode, const struct tm *t,
              const char *step_id, bool on, bool with_items, int64_t now_ms, log_patch_t *out)
{
    static rt_step_t steps[RT_MAX_STEPS];
    int n = routine_steps(cfg, kid, mode, t, steps, RT_MAX_STEPS);
    const rt_step_t *s = find_step(steps, n, step_id);
    if (!s) return;
    char path[160];
    path3(path, sizeof(path), mode_key(mode), "steps", s->id);
    if (on) patch_set_num(out, path, (double)now_ms); else patch_del(out, path);
    if (with_items)
        for (int i = 0; i < s->n_items; i++) {
            path3(path, sizeof(path), mode_key(mode), "items", s->items[i].key);
            if (on) patch_set_bool(out, path, true); else patch_del(out, path);
        }
    settle(cfg, log, kid, mode, t, now_ms, out);
}

void act_item(const cJSON *cfg, const cJSON *log, const char *kid, app_mode_t mode, const struct tm *t,
              const char *step_id, const char *item_text, bool on, bool auto_step, int64_t now_ms, log_patch_t *out)
{
    static rt_step_t steps[RT_MAX_STEPS];
    int n = routine_steps(cfg, kid, mode, t, steps, RT_MAX_STEPS);
    const rt_step_t *s = find_step(steps, n, step_id);
    if (!s) return;
    char k[64], path[160];
    ikey(s->id, item_text, k, sizeof(k));
    path3(path, sizeof(path), mode_key(mode), "items", k);
    if (on) patch_set_bool(out, path, true); else patch_del(out, path);
    if (auto_step) {
        // 이 항목을 바꾼 뒤 그 단계의 확인 목록이 다 찼으면 단계도 완료, 아니면 완료 취소
        bool all = true;
        for (int i = 0; i < s->n_items; i++) {
            bool v = !strcmp(s->items[i].key, k) ? on : item_done(log, mode, s->items[i].key);
            if (!v) all = false;
        }
        path3(path, sizeof(path), mode_key(mode), "steps", s->id);
        bool was = step_done(log, mode, s->id);
        if (all && !was) patch_set_num(out, path, (double)now_ms);
        if (!all && was) patch_del(out, path);
    }
    settle(cfg, log, kid, mode, t, now_ms, out);
}

void act_chore(const char *chore_id, bool on, int64_t now_ms, log_patch_t *out)
{
    char path[160];
    snprintf(path, sizeof(path), "chores.items.%s", chore_id);
    if (on) patch_set_num(out, path, (double)now_ms); else patch_del(out, path);
}

void act_mood(bool pm, int v, int64_t now_ms, log_patch_t *out)
{
    cJSON *m = cJSON_CreateObject();
    cJSON_AddNumberToObject(m, "v", v);
    cJSON_AddNumberToObject(m, "at", (double)now_ms);
    patch_set_json(out, pm ? "mood.pm" : "mood.am", m);
}
