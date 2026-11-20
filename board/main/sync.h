// sync.h — Firestore와 보드 화면 사이의 데이터: 주기적으로 읽고, 누른 것을 순서대로 보낸다
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "cJSON.h"
#include "fs_json.h"

#define BOARD_MAX_KIDS 4

typedef struct {
    cJSON *cfg;                          // state/config (보통 JSON, 필요한 칸만)
    int n_kids;
    char kid_ids[BOARD_MAX_KIDS][24];
    cJSON *logs[BOARD_MAX_KIDS];         // 오늘 하루 기록 (없으면 빈 객체)
    cJSON *stats[BOARD_MAX_KIDS];        // 별·연속 발사
    cJSON *adult_log;                    // 아빠의 오늘 (아이들에게 보이게 둔 기록만 여기에 있음)
    char date[11];                       // 위 기록의 날짜
    uint32_t version;                    // 바뀔 때마다 1씩 올라감 → 화면을 다시 그림
    bool need_join;                      // 초대 코드가 필요함
    bool joining;
    char join_msg[160];
    int pending;                         // 아직 못 보낸 체크 수
    int last_status;                     // 마지막 HTTP 상태
    int64_t last_ok_us;                  // 마지막으로 읽기에 성공한 때
} board_state_t;

void sync_start(void);
board_state_t *sync_lock(void);          // 상태를 읽거나 고치기 전에 잠근다
void sync_unlock(void);
int sync_kid_index(const board_state_t *st, const char *kid_id);

// 보드에서 누른 것: 화면에 바로 반영하고 보내기 줄에 넣는다 (p는 복사됨, 호출한 쪽이 patch_free)
void sync_submit(const log_patch_t *p);
void sync_request_join(const char *code);
void sync_kick(void);                    // 지금 바로 다시 읽기
