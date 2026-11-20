// model.c — app.js의 vacationState / isSchoolDay / autoMode / timeLeft / routineSteps 를 옮긴 것.
// 앱 쪽 규칙이 바뀌면 여기도 같이 고쳐야 한다. (test/test_logic.c 가 앱 코드와 결과를 비교한다)
#include "model.h"
#include "ikey.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *WD[] = {"일", "월", "화", "수", "목", "금", "토"};

// ---------- JSON 도우미 ----------
const cJSON *jget(const cJSON *o, const char *key)
{
    if (!o || !cJSON_IsObject(o) || !key) return NULL;
    return cJSON_GetObjectItemCaseSensitive(o, key);
}

const cJSON *jpath(const cJSON *o, const char *dotted)
{
    char buf[200];
    snprintf(buf, sizeof(buf), "%s", dotted);
    const cJSON *cur = o;
    for (char *save = NULL, *seg = strtok_r(buf, ".", &save); seg && cur; seg = strtok_r(NULL, ".", &save))
        cur = jget(cur, seg);
    return cur;
}

const char *jstr(const cJSON *o, const char *key, const char *def)
{
    const cJSON *v = jget(o, key);
    return (v && cJSON_IsString(v) && v->valuestring) ? v->valuestring : def;
}

double jnum(const cJSON *o, const char *key, double def)
{
    const cJSON *v = jget(o, key);
    return (v && cJSON_IsNumber(v)) ? v->valuedouble : def;
}

bool jtruthy(const cJSON *v)
{
    if (!v || cJSON_IsNull(v) || cJSON_IsFalse(v)) return false;
    if (cJSON_IsNumber(v)) return v->valuedouble != 0;
    if (cJSON_IsString(v)) return v->valuestring && v->valuestring[0];
    return true; // true, 객체, 배열
}

// ---------- 설정 채우기 (store.js normalizeConfig) ----------
static bool nullish(const cJSON *v) { return !v || cJSON_IsNull(v); }

static void put(cJSON *o, const char *key, cJSON *val)
{
    if (cJSON_GetObjectItemCaseSensitive(o, key)) cJSON_DeleteItemFromObjectCaseSensitive(o, key);
    cJSON_AddItemToObject(o, key, val);
}

void normalize_config(cJSON *cfg, const char *defaults_json)
{
    if (!cfg || !cJSON_IsObject(cfg) || !defaults_json) return;
    cJSON *d = cJSON_Parse(defaults_json);
    if (!d) return;
    const cJSON *e;
    // Object.keys(d).forEach(k => { if (cfg[k] == null) cfg[k] = d[k]; })
    cJSON_ArrayForEach(e, jget(d, "defaults"))
        if (nullish(cJSON_GetObjectItemCaseSensitive(cfg, e->string))) put(cfg, e->string, cJSON_Duplicate(e, 1));
    if (!cJSON_IsObject(jget(cfg, "routines"))) put(cfg, "routines", cJSON_CreateObject());
    if (!cJSON_IsObject(jget(cfg, "chores"))) put(cfg, "chores", cJSON_CreateObject());
    cJSON *routines = cJSON_GetObjectItemCaseSensitive(cfg, "routines");
    cJSON *chores = cJSON_GetObjectItemCaseSensitive(cfg, "chores");
    const cJSON *kid;
    cJSON_ArrayForEach(kid, jget(cfg, "kids")) {
        const char *id = jstr(kid, "id", NULL);
        if (!id) continue;
        // cfg.routines[kid.id] = cfg.routines[kid.id] || { morning: [], evening: [] };
        cJSON *r = cJSON_GetObjectItemCaseSensitive(routines, id);
        if (!jtruthy(r)) {
            r = cJSON_CreateObject();
            cJSON_AddItemToObject(r, "morning", cJSON_CreateArray());
            cJSON_AddItemToObject(r, "evening", cJSON_CreateArray());
            put(routines, id, r);
        }
        // if (!cfg.routines[kid.id].vacation) ... = VACATION_ROUTINE
        if (!jtruthy(jget(r, "vacation")) && cJSON_IsObject(r)) put(r, "vacation", cJSON_Duplicate(jget(d, "vacationRoutine"), 1));
        // if (!cfg.chores[kid.id]) cfg.chores[kid.id] = [];
        if (!jtruthy(cJSON_GetObjectItemCaseSensitive(chores, id))) put(chores, id, cJSON_CreateArray());
    }
    cJSON_Delete(d);
}

// ---------- 날짜와 시간 ----------
void date_key(const struct tm *t, char out[11])
{
    char buf[40];
    snprintf(buf, sizeof(buf), "%04d-%02d-%02d", t->tm_year + 1900, (t->tm_mon + 1) % 100, t->tm_mday % 100);
    memcpy(out, buf, 10);
    out[10] = 0;
}

int hm(const char *s)
{
    int h = 0, m = 0;
    if (s) sscanf(s, "%d:%d", &h, &m);
    return h * 60 + m;
}

void add_days(const struct tm *t, int n, struct tm *out)
{
    struct tm x = *t;
    x.tm_mday += n;
    x.tm_hour = 12; x.tm_min = 0; x.tm_sec = 0; x.tm_isdst = -1;
    mktime(&x);
    x.tm_hour = t->tm_hour; x.tm_min = t->tm_min; x.tm_sec = t->tm_sec;
    *out = x;
}

static bool parse_key(const char *k, struct tm *out)
{
    int y, m, d;
    if (!k || sscanf(k, "%d-%d-%d", &y, &m, &d) != 3) return false;
    memset(out, 0, sizeof(*out));
    out->tm_year = y - 1900; out->tm_mon = m - 1; out->tm_mday = d; out->tm_hour = 12; out->tm_isdst = -1;
    mktime(out);
    return true;
}

// ---------- 앱과 같은 규칙 ----------
// 방학: 시작일~끝일. 끝나기 전 7일은 "개학 연습 주간"이라 평소처럼 등교 준비를 연습한다
int vacation_state(const cJSON *cfg, const struct tm *t)
{
    const cJSON *v = jget(cfg, "vacation");
    const char *start = jstr(v, "start", ""), *end = jstr(v, "end", "");
    if (!jtruthy(jget(v, "on")) || !start[0] || !end[0]) return 0;
    char k[11];
    date_key(t, k);
    if (strcmp(k, start) < 0 || strcmp(k, end) > 0) return 0;
    struct tm e, pe;
    if (!parse_key(end, &e)) return 0;
    add_days(&e, -6, &pe);
    char pk[11];
    date_key(&pe, pk);
    return strcmp(k, pk) >= 0 ? 1 : 2;
}

bool in_vacation(const cJSON *cfg, const struct tm *t) { return vacation_state(cfg, t) == 2; }

bool is_school_day(const cJSON *cfg, const struct tm *t)
{
    const cJSON *sd = jget(cfg, "schoolDays"), *d;
    bool listed = false;
    cJSON_ArrayForEach(d, sd) if (cJSON_IsNumber(d) && (int)d->valuedouble == t->tm_wday) listed = true;
    return listed && vacation_state(cfg, t) != 2;
}

void next_school_day(const cJSON *cfg, const struct tm *t, struct tm *out)
{
    for (int i = 1; i <= 60; i++) {
        add_days(t, i, out);
        if (is_school_day(cfg, out)) return;
    }
    add_days(t, 1, out);
}

const char *mode_key(app_mode_t mode) { return mode == MODE_EVENING ? "evening" : "morning"; }

static const cJSON *times(const cJSON *cfg) { return jget(cfg, "times"); }

// 시간대: 아침(등교 준비) / 저녁(내일 준비) / 쉬는 시간
app_mode_t auto_mode(const cJSON *cfg, const struct tm *t)
{
    const cJSON *tt = times(cfg);
    int m = t->tm_hour * 60 + t->tm_min;
    struct tm tomorrow;
    add_days(t, 1, &tomorrow);
    bool school = is_school_day(cfg, t), tomorrow_school = is_school_day(cfg, &tomorrow);
    if (in_vacation(cfg, t)) {
        int w = hm(jstr(jget(cfg, "vacation"), "wake", "08:00"));
        if (m >= w && m < w + 120) return MODE_MORNING;
    }
    if (school && m >= hm(jstr(tt, "morningStart", "06:40")) && m < hm(jstr(tt, "leave", "08:10")) + 30) return MODE_MORNING;
    if (tomorrow_school && m >= hm(jstr(tt, "eveningStart", "19:30")) && m < hm(jstr(tt, "bed", "22:00")) + 60) return MODE_EVENING;
    return MODE_REST;
}

bool is_night(const cJSON *cfg, const struct tm *t)
{
    if (auto_mode(cfg, t) != MODE_REST) return false;
    const cJSON *tt = times(cfg);
    int m = t->tm_hour * 60 + t->tm_min;
    return m >= hm(jstr(tt, "bed", "22:00")) + 60 || m < hm(jstr(tt, "morningStart", "06:40"));
}

bool time_left(const cJSON *cfg, app_mode_t mode, const struct tm *t, float *frac, int *mins)
{
    const cJSON *tt = times(cfg);
    double m = t->tm_hour * 60 + t->tm_min + t->tm_sec / 60.0;
    bool vac = mode == MODE_MORNING && in_vacation(cfg, t);
    int w = hm(jstr(jget(cfg, "vacation"), "wake", "08:00"));
    int a = vac ? w : mode == MODE_MORNING ? hm(jstr(tt, "morningStart", "06:40")) : hm(jstr(tt, "eveningStart", "19:30"));
    int b = vac ? w + 90 : mode == MODE_MORNING ? hm(jstr(tt, "leave", "08:10")) : hm(jstr(tt, "bed", "22:00"));
    if (m < a - 1 || m > b + 60) return false;
    double f = (b - m) / (double)(b - a);
    if (f < 0) f = 0;
    if (f > 1) f = 1;
    if (frac) *frac = (float)f;
    if (mins) *mins = (int)lround(b - m);
    return true;
}

void routine_label(const cJSON *cfg, app_mode_t mode, const struct tm *t, char *out, size_t n)
{
    if (mode == MODE_MORNING) { snprintf(out, n, "%s", in_vacation(cfg, t) ? "아침 루틴" : "등교 준비"); return; }
    struct tm nx;
    next_school_day(cfg, t, &nx);
    struct tm a = *t, b = nx;
    a.tm_hour = b.tm_hour = 12; a.tm_min = b.tm_min = a.tm_sec = b.tm_sec = 0; a.tm_isdst = b.tm_isdst = -1;
    long diff = lround(difftime(mktime(&b), mktime(&a)) / 86400.0);
    if (diff == 1) snprintf(out, n, "내일 준비");
    else if (diff < 7) snprintf(out, n, "%s요일 준비", WD[nx.tm_wday]);
    else snprintf(out, n, "%d/%d 준비", nx.tm_mon + 1, nx.tm_mday);
}

static void copy_str(char *dst, size_t n, const char *src) { snprintf(dst, n, "%s", src ? src : ""); }

// 아이의 오늘 루틴 (시간표 준비물을 해당 단계 확인 목록에 끼워 넣음) — app.js routineSteps()
int routine_steps(const cJSON *cfg, const char *kid_id, app_mode_t mode, const struct tm *t, rt_step_t *out, int max)
{
    if (mode == MODE_REST) return 0;
    bool vac = mode == MODE_MORNING && in_vacation(cfg, t);
    const cJSON *steps = jget(jget(jget(cfg, "routines"), kid_id), vac ? "vacation" : mode_key(mode));
    struct tm target;
    if (mode == MODE_MORNING) target = *t; else next_school_day(cfg, t, &target);

    // 요일 시간표 준비물 + 가정통신문에서 넣은 그 날짜 준비물 (중복 없이, 처음 나온 순서대로)
    const char *sup[RT_MAX_ITEMS];
    int n_sup = 0;
    if (!vac) {
        char wd[4], dk[11];
        snprintf(wd, sizeof(wd), "%d", target.tm_wday);
        date_key(&target, dk);
        const cJSON *lists[2] = {
            jget(jget(jget(cfg, "timetable"), kid_id), wd),
            jget(jget(jget(cfg, "dateSupplies"), kid_id), dk),
        };
        for (int l = 0; l < 2; l++) {
            const cJSON *s;
            cJSON_ArrayForEach(s, lists[l]) {
                if (!cJSON_IsString(s) || n_sup >= RT_MAX_ITEMS) continue;
                bool dup = false;
                for (int i = 0; i < n_sup; i++) if (!strcmp(sup[i], s->valuestring)) dup = true;
                if (!dup) sup[n_sup++] = s->valuestring;
            }
        }
    }

    int n = 0;
    const cJSON *s;
    cJSON_ArrayForEach(s, steps) {
        if (n >= max) break;
        rt_step_t *st = &out[n];
        memset(st, 0, sizeof(*st));
        copy_str(st->id, sizeof(st->id), jstr(s, "id", ""));
        copy_str(st->title, sizeof(st->title), jstr(s, "title", ""));
        copy_str(st->detail, sizeof(st->detail), jstr(s, "detail", ""));
        copy_str(st->emoji, sizeof(st->emoji), jstr(s, "emoji", ""));
        copy_str(st->photo, sizeof(st->photo), jstr(s, "photo", ""));
        if (jtruthy(jget(s, "supplies")))
            for (int i = 0; i < n_sup && st->n_items < RT_MAX_ITEMS; i++) {
                rt_item_t *it = &st->items[st->n_items++];
                copy_str(it->text, sizeof(it->text), sup[i]);
                it->sup = true;
            }
        const cJSON *c;
        cJSON_ArrayForEach(c, jget(s, "checks")) {
            if (!cJSON_IsString(c) || st->n_items >= RT_MAX_ITEMS) continue;
            rt_item_t *it = &st->items[st->n_items++];
            copy_str(it->text, sizeof(it->text), c->valuestring);
            it->sup = false;
        }
        for (int i = 0; i < st->n_items; i++) ikey(st->id, st->items[i].text, st->items[i].key, sizeof(st->items[i].key));
        n++;
    }
    return n;
}

// app.js choresToday(): 요일 목록이 없으면 매일
int chores_today(const cJSON *cfg, const char *kid_id, const struct tm *t, chore_t *out, int max)
{
    int n = 0;
    const cJSON *c;
    cJSON_ArrayForEach(c, jget(jget(cfg, "chores"), kid_id)) {
        if (n >= max) break;
        const cJSON *days = jget(c, "days");
        if (days && cJSON_IsArray(days)) {
            bool today = false;
            const cJSON *d;
            cJSON_ArrayForEach(d, days) if (cJSON_IsNumber(d) && (int)d->valuedouble == t->tm_wday) today = true;
            if (!today) continue;
        }
        copy_str(out[n].id, sizeof(out[n].id), jstr(c, "id", ""));
        copy_str(out[n].title, sizeof(out[n].title), jstr(c, "title", ""));
        copy_str(out[n].emoji, sizeof(out[n].emoji), jstr(c, "emoji", ""));
        n++;
    }
    return n;
}

// ---------- 하루 기록 읽기 ----------
static const cJSON *routine_log(const cJSON *log, app_mode_t mode) { return jget(log, mode_key(mode)); }

bool step_done(const cJSON *log, app_mode_t mode, const char *step_id)
{
    return jtruthy(jget(jget(routine_log(log, mode), "steps"), step_id));
}

bool item_done(const cJSON *log, app_mode_t mode, const char *key)
{
    return jtruthy(jget(jget(routine_log(log, mode), "items"), key));
}

double completed_at(const cJSON *log, app_mode_t mode)
{
    return jnum(routine_log(log, mode), "completedAt", 0);
}

bool chore_done(const cJSON *log, const char *chore_id)
{
    return jtruthy(jget(jget(jget(log, "chores"), "items"), chore_id));
}

int study_minutes(const cJSON *log, bool *active_now, char *active_subject, size_t subj_len)
{
    const cJSON *st = jget(log, "study"), *s;
    int mins = 0;
    cJSON_ArrayForEach(s, jget(st, "sessions")) if (cJSON_IsObject(s)) mins += (int)jnum(s, "mins", 0);
    const cJSON *a = jget(st, "active");
    bool on = a && cJSON_IsObject(a);
    if (active_now) *active_now = on;
    if (active_subject && subj_len) snprintf(active_subject, subj_len, "%s", on ? jstr(a, "subject", "") : "");
    return mins;
}

int reading_pages(const cJSON *log, int *entries)
{
    int pages = 0, n = 0;
    const cJSON *r;
    cJSON_ArrayForEach(r, jget(jget(log, "reading"), "items")) if (cJSON_IsObject(r)) { pages += (int)jnum(r, "pages", 0); n++; }
    if (entries) *entries = n;
    return pages;
}

bool copy_done(const cJSON *log)
{
    const cJSON *r;
    cJSON_ArrayForEach(r, jget(jget(log, "copy"), "items")) if (cJSON_IsObject(r)) return true;
    return false;
}

// ---------- 글자 ----------
static bool is_emoji_cp(uint32_t c)
{
    return c >= 0x1F000 || (c >= 0x2600 && c <= 0x27BF) || (c >= 0x2B00 && c <= 0x2BFF) ||
           (c >= 0xFE00 && c <= 0xFE0F) || c == 0x200D || c == 0x20E3 || (c >= 0x2300 && c <= 0x23FF);
}

void strip_emoji(const char *in, char *out, size_t n)
{
    size_t o = 0;
    const unsigned char *p = (const unsigned char *)(in ? in : "");
    while (*p && o + 4 < n) {
        int len = (*p < 0x80) ? 1 : ((*p & 0xE0) == 0xC0) ? 2 : ((*p & 0xF0) == 0xE0) ? 3 : ((*p & 0xF8) == 0xF0) ? 4 : 1;
        uint32_t c = len == 1 ? *p : len == 2 ? (*p & 0x1F) : len == 3 ? (*p & 0x0F) : (*p & 0x07);
        for (int i = 1; i < len; i++) c = (c << 6) | (p[i] & 0x3F);
        if (!is_emoji_cp(c)) { memcpy(out + o, p, len); o += len; }
        p += len;
    }
    out[o] = 0;
    // 앞뒤 빈칸 정리
    size_t s = 0;
    while (out[s] == ' ') s++;
    if (s) memmove(out, out + s, strlen(out + s) + 1);
    size_t L = strlen(out);
    while (L && out[L - 1] == ' ') out[--L] = 0;
}
