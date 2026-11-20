// fs_json.h — Firestore REST의 "형식이 붙은 값"과 보통 JSON 사이 변환, 기록 고치기(patch)
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "cJSON.h"
#include "model.h"

// {"stringValue":"a"} → "a",  {"mapValue":{"fields":{...}}} → {...}  (새 cJSON, 호출한 쪽이 지움)
cJSON *fs_value_to_json(const cJSON *v);
cJSON *fs_fields_to_json(const cJSON *fields);
// 보통 JSON → Firestore 값 (정수는 integerValue, 그 밖의 수는 doubleValue)
cJSON *json_to_fs_value(const cJSON *j);

// ---------- 하루 기록 고치기 ----------
// 앱의 Store.patchLog(date, who, { 'morning.steps.m1': 시각, 'morning.items.x': null }) 와 같은 뜻.
#define PATCH_MAX_OPS 32
typedef struct {
    char path[160];  // 점으로 이은 경로 "morning.steps.m1"
    cJSON *value;    // NULL이면 지우기
} patch_op_t;

typedef struct {
    char date[11];
    char who[24];    // 아이ID
    int n;
    patch_op_t ops[PATCH_MAX_OPS];
} log_patch_t;

void patch_init(log_patch_t *p, const char *date, const char *who);
void patch_set_num(log_patch_t *p, const char *path, double v);
void patch_set_bool(log_patch_t *p, const char *path, bool v);
void patch_set_json(log_patch_t *p, const char *path, cJSON *owned);
void patch_del(log_patch_t *p, const char *path);
void patch_free(log_patch_t *p);
log_patch_t *patch_clone(const log_patch_t *p);

// 화면에 먼저 반영할 때: 보통 JSON 기록에 그대로 적용
void patch_apply(cJSON *log, const log_patch_t *p);
// PATCH 요청 본문 {"fields":{...}} (date, kidId 포함)
cJSON *patch_body(const log_patch_t *p);
// "updateMask.fieldPaths=date&updateMask.fieldPaths=kidId&updateMask.fieldPaths=%60morning%60.%60steps%60.%60m1%60"
size_t patch_mask_query(const log_patch_t *p, char *out, size_t n);

// ---------- 보드에서 누른 것 → 고칠 내용 (app.js setStep / setItem / settle / setChore) ----------
// now_ms: 지금 시각(밀리초). log: 지금 화면이 아는 그 아이의 오늘 기록(보통 JSON, 없으면 NULL)
void act_step(const cJSON *cfg, const cJSON *log, const char *kid, app_mode_t mode, const struct tm *t,
              const char *step_id, bool on, bool with_items, int64_t now_ms, log_patch_t *out);
void act_item(const cJSON *cfg, const cJSON *log, const char *kid, app_mode_t mode, const struct tm *t,
              const char *step_id, const char *item_text, bool on, bool auto_step, int64_t now_ms, log_patch_t *out);
void act_chore(const char *chore_id, bool on, int64_t now_ms, log_patch_t *out);
void act_mood(bool pm, int v, int64_t now_ms, log_patch_t *out);
