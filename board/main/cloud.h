// cloud.h — Firebase 익명 로그인, 보드 초대 코드로 가족 연결, Firestore REST 읽기/쓰기
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include "cJSON.h"
#include "esp_err.h"

esp_err_t cloud_init(void);             // NVS에서 로그인 정보와 가족ID를 읽는다
bool cloud_has_family(void);
const char *cloud_family(void);
void cloud_forget_family(void);         // 부모가 연결을 해제했을 때: 다시 초대 코드를 받는다

// 보드용 초대 코드로 가족에 들어간다. 0 = 성공, 그 밖에는 msg에 이유
int cloud_join(const char *code, char *msg, size_t msg_len);

// rel: "families/{fid}/logs/2026-11-21_k1" 처럼 documents 아래 경로. 돌려주는 값은 HTTP 상태(실패 -1)
int cloud_get(const char *rel, const char *query, cJSON **plain_out);
// rels[i]의 문서를 한 번에 읽는다. 없는 문서는 out[i] = NULL
int cloud_batch_get(const char *const *rels, int n, cJSON **out);
// body: {"fields":{...}} (Firestore 형식), query: "updateMask.fieldPaths=..." 또는 NULL
int cloud_patch(const char *rel, const char *query, const cJSON *body);
