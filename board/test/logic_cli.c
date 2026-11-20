// logic_cli.c — 보드의 C 규칙을 컴퓨터에서 돌려 JSON으로 내보낸다 (compare.mjs가 앱 결과와 비교)
// 사용: logic_cli config.json kidId epoch1 epoch2 ...   (TZ=Asia/Seoul 로 실행)
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "cJSON.h"
#include "model.h"
#include "fs_json.h"
#include "ikey.h"

static char *read_file(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *b = malloc(n + 1);
    fread(b, 1, n, f);
    b[n] = 0;
    fclose(f);
    return b;
}

static cJSON *steps_json(const cJSON *cfg, const char *kid, app_mode_t mode, const struct tm *t)
{
    static rt_step_t steps[RT_MAX_STEPS];
    int n = routine_steps(cfg, kid, mode, t, steps, RT_MAX_STEPS);
    cJSON *arr = cJSON_CreateArray();
    for (int i = 0; i < n; i++) {
        cJSON *s = cJSON_CreateObject();
        cJSON_AddStringToObject(s, "id", steps[i].id);
        cJSON *items = cJSON_AddArrayToObject(s, "items");
        for (int j = 0; j < steps[i].n_items; j++) {
            cJSON *it = cJSON_CreateObject();
            cJSON_AddStringToObject(it, "text", steps[i].items[j].text);
            cJSON_AddStringToObject(it, "key", steps[i].items[j].key);
            cJSON_AddBoolToObject(it, "sup", steps[i].items[j].sup);
            cJSON_AddItemToArray(items, it);
        }
        cJSON_AddItemToArray(arr, s);
    }
    return arr;
}

int main(int argc, char **argv)
{
    if (argc < 4) { fprintf(stderr, "usage: logic_cli config.json kid epoch...\n"); return 2; }
    char *txt = read_file(argv[1]);
    cJSON *cfg = cJSON_Parse(txt);
    const char *kid = argv[2];
    cJSON *out = cJSON_CreateArray();
    for (int a = 3; a < argc; a++) {
        time_t e = (time_t)atoll(argv[a]);
        struct tm t;
        localtime_r(&e, &t);
        cJSON *r = cJSON_CreateObject();
        cJSON_AddNumberToObject(r, "epoch", (double)e);
        app_mode_t m = auto_mode(cfg, &t);
        cJSON_AddStringToObject(r, "mode", m == MODE_MORNING ? "morning" : m == MODE_EVENING ? "evening" : "rest");
        cJSON_AddBoolToObject(r, "school", is_school_day(cfg, &t));
        cJSON_AddNumberToObject(r, "vac", vacation_state(cfg, &t));
        char label[48];
        routine_label(cfg, MODE_EVENING, &t, label, sizeof(label));
        cJSON_AddStringToObject(r, "eveningLabel", label);
        float f; int mins;
        cJSON_AddNumberToObject(r, "leftMorning", time_left(cfg, MODE_MORNING, &t, &f, &mins) ? mins : -9999);
        cJSON_AddNumberToObject(r, "leftEvening", time_left(cfg, MODE_EVENING, &t, &f, &mins) ? mins : -9999);
        cJSON_AddItemToObject(r, "morning", steps_json(cfg, kid, MODE_MORNING, &t));
        cJSON_AddItemToObject(r, "evening", steps_json(cfg, kid, MODE_EVENING, &t));
        cJSON_AddItemToArray(out, r);
    }
    char *s = cJSON_PrintUnformatted(out);
    puts(s);
    return 0;
}
