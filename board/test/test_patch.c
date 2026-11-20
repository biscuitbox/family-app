// test_patch.c — 보드가 보내는 PATCH의 모양과, 누름 → 고칠 내용 변환을 확인한다
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "cJSON.h"
#include "fs_json.h"
#include "model.h"

static int fails = 0;
#define CHECK(c, msg) do { if (!(c)) { fails++; printf("실패: %s\n", msg); } } while (0)

static cJSON *load(const char *p)
{
    FILE *f = fopen(p, "rb");
    fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
    char *b = malloc(n + 1); fread(b, 1, n, f); b[n] = 0; fclose(f);
    cJSON *j = cJSON_Parse(b); free(b); return j;
}

static bool has_op(const log_patch_t *p, const char *path, bool set)
{
    for (int i = 0; i < p->n; i++) if (!strcmp(p->ops[i].path, path)) return set ? p->ops[i].value != NULL : p->ops[i].value == NULL;
    return false;
}

int main(int argc, char **argv)
{
    cJSON *cfg = load(argc > 1 ? argv[1] : "build/config_school.json");
    // 2026-11-23(월) 07:30 KST
    struct tm t = {0};
    t.tm_year = 126; t.tm_mon = 10; t.tm_mday = 23; t.tm_hour = 7; t.tm_min = 30; t.tm_isdst = -1;
    mktime(&t);
    int64_t now = 1795213800000LL;

    // 1. 마스크와 본문
    log_patch_t p;
    patch_init(&p, "2026-11-23", "k1");
    patch_set_num(&p, "morning.steps.m3", 1795213800000.0);
    patch_del(&p, "morning.completedAt");
    char q[1024];
    patch_mask_query(&p, q, sizeof(q));
    CHECK(!strcmp(q, "updateMask.fieldPaths=date&updateMask.fieldPaths=kidId&updateMask.fieldPaths=%60morning%60.%60steps%60.%60m3%60&updateMask.fieldPaths=%60morning%60.%60completedAt%60"), q);
    cJSON *body = patch_body(&p);
    char *bs = cJSON_PrintUnformatted(body);
    CHECK(strstr(bs, "\"m3\":{\"integerValue\":\"1795213800000\"}") != NULL, bs);
    CHECK(strstr(bs, "completedAt") == NULL, "지우는 칸은 본문에 없어야 함");
    CHECK(strstr(bs, "\"kidId\":{\"stringValue\":\"k1\"}") != NULL, "kidId 포함");
    free(bs); cJSON_Delete(body); patch_free(&p);

    // 2. Firestore 값 → 보통 JSON → 다시 Firestore 값
    cJSON *typed = cJSON_Parse("{\"a\":{\"integerValue\":\"1795213800000\"},\"b\":{\"mapValue\":{\"fields\":{\"c\":{\"booleanValue\":true},\"d\":{\"arrayValue\":{\"values\":[{\"stringValue\":\"체육복\"}]}}}}},\"e\":{\"doubleValue\":1.5},\"f\":{\"nullValue\":null}}");
    cJSON *plain = fs_fields_to_json(typed);
    char *ps = cJSON_PrintUnformatted(plain);
    CHECK(!strcmp(ps, "{\"a\":1795213800000,\"b\":{\"c\":true,\"d\":[\"체육복\"]},\"e\":1.5,\"f\":null}"), ps);
    free(ps); cJSON_Delete(typed); cJSON_Delete(plain);

    // 3. 목록 보기에서 단계 체크(확인 목록까지) → 다른 단계가 남아 있으니 completedAt 없음
    patch_init(&p, "2026-11-23", "k2");
    act_step(cfg, NULL, "k2", MODE_MORNING, &t, "m4", true, true, now, &p);
    CHECK(has_op(&p, "morning.steps.m4", true), "m4 완료");
    CHECK(p.n >= 3, "가방 확인의 확인 목록도 함께 체크");
    CHECK(!has_op(&p, "morning.completedAt", true), "아직 다 안 함");
    patch_free(&p);

    // 4. 마지막 단계를 끝내면 completedAt, 다시 취소하면 completedAt 지움
    cJSON *log = cJSON_Parse("{\"date\":\"2026-11-23\",\"kidId\":\"k2\",\"morning\":{\"steps\":{\"m1\":1,\"m2\":1,\"m3\":1,\"m4\":1}}}");
    patch_init(&p, "2026-11-23", "k2");
    act_step(cfg, log, "k2", MODE_MORNING, &t, "m5", true, false, now, &p);
    CHECK(has_op(&p, "morning.completedAt", true), "다 하면 completedAt");
    patch_apply(log, &p);
    patch_free(&p);
    patch_init(&p, "2026-11-23", "k2");
    act_step(cfg, log, "k2", MODE_MORNING, &t, "m2", false, false, now, &p);
    CHECK(has_op(&p, "morning.completedAt", false), "취소하면 completedAt 지움");
    patch_free(&p);
    cJSON_Delete(log);

    // 5. 목록 보기에서 확인 항목을 마지막까지 누르면 그 단계가 저절로 완료
    static rt_step_t steps[RT_MAX_STEPS];
    int n = routine_steps(cfg, "k2", MODE_MORNING, &t, steps, RT_MAX_STEPS);
    const rt_step_t *bag = NULL;
    for (int i = 0; i < n; i++) if (!strcmp(steps[i].id, "m4")) bag = &steps[i];
    CHECK(bag && bag->n_items >= 2, "둘째 가방 확인 항목");
    cJSON *log2 = cJSON_CreateObject();
    for (int i = 0; bag && i < bag->n_items - 1; i++) {
        patch_init(&p, "2026-11-23", "k2");
        act_item(cfg, log2, "k2", MODE_MORNING, &t, "m4", bag->items[i].text, true, true, now, &p);
        CHECK(!has_op(&p, "morning.steps.m4", true), "아직 남은 항목");
        patch_apply(log2, &p); patch_free(&p);
    }
    patch_init(&p, "2026-11-23", "k2");
    if (bag) act_item(cfg, log2, "k2", MODE_MORNING, &t, "m4", bag->items[bag->n_items - 1].text, true, true, now, &p);
    CHECK(has_op(&p, "morning.steps.m4", true), "마지막 항목을 누르면 단계 완료");
    patch_free(&p);
    cJSON_Delete(log2);

    // 6. 집안일, 기분
    patch_init(&p, "2026-11-23", "k1");
    act_chore("c1", true, now, &p);
    act_mood(false, 1, now, &p);
    patch_mask_query(&p, q, sizeof(q));
    CHECK(strstr(q, "%60chores%60.%60items%60.%60c1%60") != NULL, q);
    CHECK(strstr(q, "%60mood%60.%60am%60") != NULL, q);
    patch_free(&p);

    // 7. 이모지 빼기
    char s[64];
    strip_emoji("🎒 가방 확인 😀", s, sizeof(s));
    CHECK(!strcmp(s, "가방 확인"), s);

    printf(fails ? "patch 시험: 실패 %d개\n" : "patch 시험: 모두 통과\n", fails);
    cJSON_Delete(cfg);
    return fails ? 1 : 0;
}
