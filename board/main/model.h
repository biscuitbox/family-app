// model.h — 앱 app.js의 시간대·루틴 규칙을 C로 옮긴 것 (ESP-IDF 없이도 컴파일됨)
//
// 설정과 기록은 Firestore 문서를 "보통 JSON"(앱의 JS 객체와 같은 모양)으로 바꾼 cJSON으로 다룬다.
// 그래서 여기 함수들은 app.js의 같은 이름 함수와 한 줄씩 비교하며 읽을 수 있다.
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <time.h>
#include "cJSON.h"

typedef enum { MODE_REST = 0, MODE_MORNING, MODE_EVENING } app_mode_t;

#define RT_MAX_STEPS 16
#define RT_MAX_ITEMS 12
#define CHORE_MAX 12

typedef struct {
    char text[96];   // 화면에 보이는 글자 (이모지 포함, 원문 그대로 — 키 계산에 씀)
    char key[64];    // ikey(단계ID, text)
    bool sup;        // 시간표·가정통신문 준비물에서 온 항목
} rt_item_t;

typedef struct {
    char id[48];
    char title[96];
    char detail[160];
    char emoji[16];
    char photo[48];
    int n_items;
    rt_item_t items[RT_MAX_ITEMS];
} rt_step_t;

typedef struct {
    char id[48];
    char title[96];
    char emoji[16];
} chore_t;

// ---------- JSON 도우미 ----------
const cJSON *jget(const cJSON *o, const char *key);          // 없거나 객체가 아니면 NULL
const cJSON *jpath(const cJSON *o, const char *dotted);      // "a.b.c"
const char *jstr(const cJSON *o, const char *key, const char *def);
double jnum(const cJSON *o, const char *key, double def);
bool jtruthy(const cJSON *v);                                // JS의 !!v 와 같게

// ---------- 설정 채우기 ----------
// 앱 store.js normalizeConfig()와 같게: 저장된 설정에 없는 칸(집안일, 방학 등)을 앱 기본값으로 채운다.
// defaults_json: tools/make_defaults.mjs가 만든 {"defaults":{...},"vacationRoutine":[...]}
void normalize_config(cJSON *cfg, const char *defaults_json);

// ---------- 날짜와 시간 ----------
void date_key(const struct tm *t, char out[11]);             // "2026-11-21"
int hm(const char *s);                                        // "06:40" → 400
void add_days(const struct tm *t, int n, struct tm *out);

// ---------- 앱과 같은 규칙 ----------
int vacation_state(const cJSON *cfg, const struct tm *t);    // 0 아님, 1 개학 연습 주간, 2 방학
bool in_vacation(const cJSON *cfg, const struct tm *t);
bool is_school_day(const cJSON *cfg, const struct tm *t);
void next_school_day(const cJSON *cfg, const struct tm *t, struct tm *out);
app_mode_t auto_mode(const cJSON *cfg, const struct tm *t);
bool is_night(const cJSON *cfg, const struct tm *t);         // 보드 전용: 화면을 어둡게 하는 시간
bool time_left(const cJSON *cfg, app_mode_t mode, const struct tm *t, float *frac, int *mins);
void routine_label(const cJSON *cfg, app_mode_t mode, const struct tm *t, char *out, size_t n);
const char *mode_key(app_mode_t mode);                        // "morning" / "evening"
int routine_steps(const cJSON *cfg, const char *kid_id, app_mode_t mode, const struct tm *t,
                  rt_step_t *out, int max);
int chores_today(const cJSON *cfg, const char *kid_id, const struct tm *t, chore_t *out, int max);

// ---------- 하루 기록 읽기 ----------
bool step_done(const cJSON *log, app_mode_t mode, const char *step_id);
bool item_done(const cJSON *log, app_mode_t mode, const char *key);
double completed_at(const cJSON *log, app_mode_t mode);
bool chore_done(const cJSON *log, const char *chore_id);
int study_minutes(const cJSON *log, bool *active_now, char *active_subject, size_t subj_len);
int reading_pages(const cJSON *log, int *entries);
bool copy_done(const cJSON *log);

// ---------- 글자 ----------
// 보드 글꼴에는 이모지가 없어서 화면에 쓸 때만 뺀다 (키 계산에는 원문을 쓴다).
void strip_emoji(const char *in, char *out, size_t n);
