// ui.c — 관제 센터 보드 화면
//
// 세로 800×1280: 위 가족 띠(날짜·시계·아빠의 오늘) + 아이 칸 두 개(위아래)
// 시간대는 앱과 같은 규칙(model.c auto_mode)으로 바뀐다:
//   등교 준비 / 내일 준비 → 루틴 체크 (아이 설정이 cards면 한 단계씩, list면 목록)
//   그 밖의 낮 → 오늘의 미션, 공부·독서·필사·집안일 상태, 집안일 체크, 감정 체크인
//   밤 → 시계와 오늘 한 것만, 화면을 어둡게 (누르면 30초 밝아짐)
// 두 아이를 비교하는 숫자(순위, 별 대결)는 그리지 않는다. 기분은 고른 뒤 "체크인 했어요"만 보인다.
#include "ui.h"
#include <stdio.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "fs_json.h"
#include "hw.h"
#include "model.h"
#include "net.h"
#include "sync.h"

// ---------- 글꼴 (보드에 넣은 한글 글꼴을 크기별로) ----------
extern const uint8_t font_reg_start[] asm("_binary_board_sans_regular_ttf_start");
extern const uint8_t font_reg_end[] asm("_binary_board_sans_regular_ttf_end");
extern const uint8_t font_bold_start[] asm("_binary_board_sans_semibold_ttf_start");
extern const uint8_t font_bold_end[] asm("_binary_board_sans_semibold_ttf_end");
static lv_font_t *F_SMALL, *F_BODY, *F_TITLE, *F_BIG, *F_HUGE;

// ---------- 색 (앱의 '우주 실험실') ----------
#define C_BG 0x0B1020
#define C_PANEL 0x151C36
#define C_LINE 0x2A3460
#define C_TEXT 0xE8ECFF
#define C_QUIET 0x9AA3C7
#define C_MORNING 0xFF9F43
#define C_EVENING 0xA78BFA
#define C_DONE 0x39FF88
#define C_ION 0x22D3EE
#define C_WARN 0xFF5C7A

static const char *MOOD5[] = {"신나요", "좋아요", "그저 그래요", "속상해요", "화나요"};
static const char *WD[] = {"일", "월", "화", "수", "목", "금", "토"};

// ---------- 누름 ----------
typedef enum { A_TICK, A_MINI, A_ITEM, A_DONE, A_NEXT, A_PREV, A_CHORE, A_MOOD, A_REVIEW, A_WAKE, A_JOIN } act_kind_t;
typedef struct {
    act_kind_t kind;
    int8_t kid;     // 아이 칸 번호
    bool on;
    int v;
    char a[64];     // 단계ID / 집안일ID
    char b[96];     // 확인 항목 글자
} act_t;
#define ACT_MAX 256
static act_t s_acts[ACT_MAX];
static int s_n_acts;

static lv_obj_t *s_top, *s_main, *s_join_ta;
static uint32_t s_seen_version = UINT32_MAX;
static int s_seen_minute = -1;
static bool s_dirty = true;
static int s_card[BOARD_MAX_KIDS] = {-1, -1, -1, -1};
static bool s_review[BOARD_MAX_KIDS];
static int64_t s_wake_until;

static act_t *new_act(act_kind_t k, int kid)
{
    if (s_n_acts >= ACT_MAX) return NULL;
    act_t *a = &s_acts[s_n_acts++];
    memset(a, 0, sizeof(*a));
    a->kind = k;
    a->kid = kid;
    return a;
}

static int64_t now_ms(void)
{
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

static void now_tm(struct tm *t)
{
    time_t n = time(NULL);
    localtime_r(&n, t);
}

// ---------- 그리기 도우미 ----------
static lv_obj_t *box(lv_obj_t *parent, lv_flex_flow_t flow)
{
    lv_obj_t *o = lv_obj_create(parent);
    lv_obj_remove_style_all(o);
    lv_obj_set_size(o, LV_PCT(100), LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(o, flow);
    lv_obj_set_style_pad_gap(o, 10, 0);
    return o;
}

static lv_obj_t *label(lv_obj_t *parent, const char *text, const lv_font_t *f, uint32_t color)
{
    lv_obj_t *l = lv_label_create(parent);
    char clean[256];
    strip_emoji(text, clean, sizeof(clean));
    lv_label_set_text(l, clean);
    lv_obj_set_style_text_font(l, f, 0);
    lv_obj_set_style_text_color(l, lv_color_hex(color), 0);
    return l;
}

static void on_click(lv_event_t *e);

static lv_obj_t *button(lv_obj_t *parent, const char *text, const lv_font_t *f, uint32_t bg, uint32_t fg, act_t *a)
{
    lv_obj_t *b = lv_button_create(parent);
    lv_obj_set_style_bg_color(b, lv_color_hex(bg), 0);
    lv_obj_set_style_radius(b, 16, 0);
    lv_obj_set_style_shadow_width(b, 0, 0);
    lv_obj_set_style_pad_hor(b, 22, 0);
    lv_obj_set_style_pad_ver(b, 14, 0);
    lv_obj_set_style_min_height(b, 64, 0);
    lv_obj_t *l = label(b, text, f, fg);
    lv_obj_center(l);
    if (a) lv_obj_add_event_cb(b, on_click, LV_EVENT_CLICKED, a);
    return b;
}

static lv_obj_t *chip(lv_obj_t *parent, const char *text, bool on, act_t *a)
{
    char t[140];
    snprintf(t, sizeof(t), "%s %s", on ? LV_SYMBOL_OK : "  ", text);
    lv_obj_t *b = button(parent, t, F_BODY, on ? 0x1D4D36 : C_LINE, on ? C_DONE : C_TEXT, a);
    lv_obj_set_style_pad_ver(b, 10, 0);
    lv_obj_set_style_min_height(b, 56, 0);
    return b;
}

// ---------- 위 가족 띠 ----------
static void adult_line(const cJSON *log, char *out, size_t n)
{
    out[0] = 0;
    size_t o = 0;
    const cJSON *it;
    cJSON_ArrayForEach(it, jget(jget(log, "exercise"), "items"))
        if (cJSON_IsObject(it) && o < n - 40) o += snprintf(out + o, n - o, "%s%s %d분", o ? " · " : "", jstr(it, "kind", "운동"), (int)jnum(it, "mins", 0));
    cJSON_ArrayForEach(it, jget(jget(log, "reading"), "items"))
        if (cJSON_IsObject(it) && o < n - 40) o += snprintf(out + o, n - o, "%s독서 %d쪽", o ? " · " : "", (int)jnum(it, "pages", 0));
    cJSON_ArrayForEach(it, jget(jget(log, "research"), "items"))
        if (cJSON_IsObject(it) && o < n - 60) o += snprintf(out + o, n - o, "%s%s", o ? " · " : "", jstr(it, "text", "연구"));
}

static void build_top(board_state_t *st, const struct tm *t)
{
    lv_obj_clean(s_top);
    lv_obj_t *row = box(s_top, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(row, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END);
    char buf[96];
    snprintf(buf, sizeof(buf), "%d월 %d일 %s요일", t->tm_mon + 1, t->tm_mday, WD[t->tm_wday]);
    label(row, buf, F_TITLE, C_TEXT);
    snprintf(buf, sizeof(buf), "%02d:%02d", t->tm_hour, t->tm_min);
    label(row, buf, F_BIG, C_ION);

    const char *status;
    uint32_t sc = C_QUIET;
    if (!net_up()) { status = "Wi-Fi 연결 중"; sc = C_WARN; }
    else if (st->pending) { snprintf(buf, sizeof(buf), "보내는 중 %d", st->pending); status = buf; sc = C_MORNING; }
    else if (st->last_ok_us && esp_timer_get_time() - st->last_ok_us > 10LL * 60 * 1000000) { status = "기록을 못 받고 있어요"; sc = C_WARN; }
    else status = "";
    char dad[200];
    adult_line(st->adult_log, dad, sizeof(dad));
    const cJSON *adults = jget(st->cfg, "adults");
    char line[320];
    if (dad[0]) snprintf(line, sizeof(line), "%s의 오늘: %s", jstr(cJSON_GetArrayItem(adults, 0), "name", "아빠"), dad);
    else line[0] = 0;
    lv_obj_t *row2 = box(s_top, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(row2, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_t *dl = label(row2, line, F_SMALL, C_QUIET);
    lv_label_set_long_mode(dl, LV_LABEL_LONG_DOT);
    lv_obj_set_width(dl, 560);
    label(row2, status, F_SMALL, sc);
}

// ---------- 아이 칸: 루틴 ----------
static const char *kid_name(const board_state_t *st, int k)
{
    return jstr(cJSON_GetArrayItem(jget(st->cfg, "kids"), k), "name", st->kid_ids[k]);
}

static bool kid_cards(const board_state_t *st, int k)
{
    return !strcmp(jstr(cJSON_GetArrayItem(jget(st->cfg, "kids"), k), "view", "list"), "cards");
}

static void latest_cheer(const cJSON *log, char *out, size_t n)
{
    out[0] = 0;
    double best = 0;
    const cJSON *c;
    cJSON_ArrayForEach(c, jget(log, "cheers")) {
        if (!cJSON_IsObject(c) || jnum(c, "at", 0) < best) continue;
        best = jnum(c, "at", 0);
        snprintf(out, n, "%s: %s", jstr(c, "from", "아빠"), jstr(c, "text", ""));
    }
}

static void panel_header(lv_obj_t *p, board_state_t *st, int k, const char *sub, uint32_t sub_color, const char *right)
{
    lv_obj_t *row = box(p, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(row, LV_FLEX_ALIGN_SPACE_BETWEEN, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END);
    lv_obj_t *left = box(row, LV_FLEX_FLOW_ROW);
    lv_obj_set_width(left, LV_SIZE_CONTENT);
    lv_obj_set_flex_align(left, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END);
    label(left, kid_name(st, k), F_TITLE, C_TEXT);
    label(left, sub, F_BODY, sub_color);
    if (right) label(row, right, F_BODY, C_QUIET);
    char cheer[200];
    latest_cheer(st->logs[k], cheer, sizeof(cheer));
    if (cheer[0]) {
        lv_obj_t *cl = label(p, cheer, F_SMALL, C_ION);
        lv_label_set_long_mode(cl, LV_LABEL_LONG_DOT);
        lv_obj_set_width(cl, LV_PCT(100));
    }
}

static void build_routine(lv_obj_t *p, board_state_t *st, int k, app_mode_t mode, const struct tm *t)
{
    static rt_step_t steps[RT_MAX_STEPS];
    const cJSON *log = st->logs[k];
    int n = routine_steps(st->cfg, st->kid_ids[k], mode, t, steps, RT_MAX_STEPS);
    uint32_t mc = mode == MODE_MORNING ? C_MORNING : C_EVENING;
    char lbl[48], right[48] = "";
    routine_label(st->cfg, mode, t, lbl, sizeof(lbl));
    float frac = 0;
    int mins = 0;
    bool has_left = time_left(st->cfg, mode, t, &frac, &mins);
    if (has_left) snprintf(right, sizeof(right), mins > 0 ? "%s까지 %d분" : "시간이 지났어요", mode == MODE_MORNING ? "출발" : "잠잘 시간", mins);
    panel_header(p, st, k, lbl, mc, has_left ? right : NULL);

    if (has_left) { // 연료 게이지
        lv_obj_t *bar = lv_bar_create(p);
        lv_obj_set_size(bar, LV_PCT(100), 18);
        lv_bar_set_range(bar, 0, 100);
        lv_bar_set_value(bar, (int)(frac * 100), LV_ANIM_OFF);
        lv_obj_set_style_bg_color(bar, lv_color_hex(C_LINE), LV_PART_MAIN);
        lv_obj_set_style_bg_color(bar, lv_color_hex(frac < 0.15f ? C_WARN : mc), LV_PART_INDICATOR);
    }
    if (!n) { label(p, "오늘은 할 단계가 없어요", F_BODY, C_QUIET); return; }

    double done_at = completed_at(log, mode);
    if (done_at && !s_review[k]) { // 다 했어요 화면
        time_t ts = (time_t)(done_at / 1000);
        struct tm dt;
        localtime_r(&ts, &dt);
        char buf[64];
        label(p, mode == MODE_MORNING ? "준비 끝! 발사 성공" : "내일 준비 끝!", F_BIG, C_DONE);
        snprintf(buf, sizeof(buf), "%02d:%02d에 다 했어요", dt.tm_hour, dt.tm_min);
        label(p, buf, F_BODY, C_TEXT);
        label(p, "별은 곧 들어와요", F_SMALL, C_QUIET);
        act_t *a = new_act(A_REVIEW, k);
        if (a) { a->on = true; button(p, "다시 보기", F_BODY, C_LINE, C_TEXT, a); }
        return;
    }

    if (kid_cards(st, k)) { // 한 화면에 한 단계
        int idx = s_card[k];
        int first = -1;
        for (int i = 0; i < n; i++) if (!step_done(log, mode, steps[i].id)) { first = i; break; }
        if (idx < 0 || idx >= n) idx = first < 0 ? 0 : first;
        s_card[k] = idx;
        const rt_step_t *s = &steps[idx];
        bool done = step_done(log, mode, s->id);
        int left = 0;
        for (int i = 0; i < s->n_items; i++) if (!item_done(log, mode, s->items[i].key)) left++;
        char buf[64];
        snprintf(buf, sizeof(buf), "%d / %d 단계%s", idx + 1, n, done ? " · 완료" : "");
        label(p, buf, F_SMALL, done ? C_DONE : C_QUIET);
        label(p, s->title, F_BIG, C_TEXT);
        if (s->detail[0]) label(p, s->detail, F_BODY, C_QUIET);
        if (s->n_items) {
            lv_obj_t *wrap = box(p, LV_FLEX_FLOW_ROW_WRAP);
            for (int i = 0; i < s->n_items; i++) {
                act_t *a = new_act(A_ITEM, k);
                if (!a) break;
                snprintf(a->a, sizeof(a->a), "%s", s->id);
                snprintf(a->b, sizeof(a->b), "%s", s->items[i].text);
                a->on = !item_done(log, mode, s->items[i].key);
                chip(wrap, s->items[i].text, !a->on, a);
            }
        }
        lv_obj_t *row = box(p, LV_FLEX_FLOW_ROW);
        if (idx > 0) { act_t *a = new_act(A_PREV, k); button(row, "이전", F_BODY, C_LINE, C_TEXT, a); }
        if (done) {
            act_t *a = new_act(A_NEXT, k);
            button(row, "다음으로", F_TITLE, mc, C_BG, a);
        } else {
            act_t *a = new_act(A_DONE, k);
            if (a) snprintf(a->a, sizeof(a->a), "%s", s->id);
            lv_obj_t *b = button(row, "다 했어요", F_TITLE, mc, C_BG, a);
            if (left) {
                lv_obj_add_state(b, LV_STATE_DISABLED);
                lv_obj_set_style_bg_opa(b, LV_OPA_40, LV_STATE_DISABLED);
                snprintf(buf, sizeof(buf), "위에서 %d개를 더 누르면 켜져요", left);
                label(p, buf, F_SMALL, C_QUIET);
            }
        }
        return;
    }

    // 목록 보기: 단계마다 한 줄 + 확인 항목
    lv_obj_t *list = box(p, LV_FLEX_FLOW_COLUMN);
    for (int i = 0; i < n; i++) {
        const rt_step_t *s = &steps[i];
        bool on = step_done(log, mode, s->id);
        lv_obj_t *row = box(list, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(row, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
        act_t *a = new_act(A_TICK, k);
        if (a) { snprintf(a->a, sizeof(a->a), "%s", s->id); a->on = !on; }
        lv_obj_t *tick = button(row, on ? LV_SYMBOL_OK : "", F_TITLE, on ? C_DONE : C_LINE, C_BG, a);
        lv_obj_set_size(tick, 64, 64);
        lv_obj_set_style_radius(tick, 32, 0);
        lv_obj_t *tl = label(row, s->title, F_TITLE, on ? C_QUIET : C_TEXT);
        if (on) {
            char hhmm[16];
            double at = jnum(jget(jget(log, mode_key(mode)), "steps"), s->id, 0);
            time_t ts = (time_t)(at / 1000);
            struct tm dt;
            localtime_r(&ts, &dt);
            snprintf(hhmm, sizeof(hhmm), "%02d:%02d", dt.tm_hour, dt.tm_min);
            label(row, hhmm, F_SMALL, C_QUIET);
        }
        (void)tl;
        if (s->n_items && !on) {
            lv_obj_t *wrap = box(list, LV_FLEX_FLOW_ROW_WRAP);
            lv_obj_set_style_pad_left(wrap, 76, 0);
            for (int j = 0; j < s->n_items; j++) {
                act_t *m = new_act(A_MINI, k);
                if (!m) break;
                snprintf(m->a, sizeof(m->a), "%s", s->id);
                snprintf(m->b, sizeof(m->b), "%s", s->items[j].text);
                m->on = !item_done(log, mode, s->items[j].key);
                chip(wrap, s->items[j].text, !m->on, m);
            }
        }
    }
}

// ---------- 아이 칸: 쉬는 시간 ----------
static void tile(lv_obj_t *parent, const char *name, const char *state, bool done)
{
    lv_obj_t *t = lv_obj_create(parent);
    lv_obj_set_size(t, 172, 120);
    lv_obj_set_style_bg_color(t, lv_color_hex(done ? 0x163A2B : C_BG), 0);
    lv_obj_set_style_border_color(t, lv_color_hex(done ? C_DONE : C_LINE), 0);
    lv_obj_set_style_border_width(t, 2, 0);
    lv_obj_set_style_radius(t, 14, 0);
    lv_obj_set_style_pad_all(t, 12, 0);
    lv_obj_remove_flag(t, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_flex_flow(t, LV_FLEX_FLOW_COLUMN);
    label(t, name, F_TITLE, done ? C_DONE : C_TEXT);
    lv_obj_t *s = label(t, state, F_SMALL, C_QUIET);
    lv_label_set_long_mode(s, LV_LABEL_LONG_DOT);
    lv_obj_set_width(s, LV_PCT(100));
}

static void build_rest(lv_obj_t *p, board_state_t *st, int k, const struct tm *t)
{
    const cJSON *log = st->logs[k];
    // 오늘의 미션 (등교 준비는 학교 가는 날·방학에만)
    bool need_morning = is_school_day(st->cfg, t) || in_vacation(st->cfg, t);
    bool active = false;
    char subj[48];
    int smin = study_minutes(log, &active, subj, sizeof(subj));
    bool study = false;
    const cJSON *ss;
    cJSON_ArrayForEach(ss, jget(jget(log, "study"), "sessions")) if (cJSON_IsObject(ss)) study = true;
    bool copy = copy_done(log);
    int total = 2 + (need_morning ? 1 : 0);
    int done = (study ? 1 : 0) + (copy ? 1 : 0) + (need_morning && completed_at(log, MODE_MORNING) ? 1 : 0);
    char sub[64], right[48] = "";
    snprintf(sub, sizeof(sub), "오늘의 미션 %d / %d", done, total);
    int streak = (int)jnum(jget(k < BOARD_MAX_KIDS ? st->stats[k] : NULL, "streak"), "count", 0);
    if (streak > 1) snprintf(right, sizeof(right), "연속 발사 %d일", streak);
    panel_header(p, st, k, sub, done == total ? C_DONE : C_ION, right[0] ? right : NULL);

    char buf[96];
    lv_obj_t *tiles = box(p, LV_FLEX_FLOW_ROW);
    if (active) snprintf(buf, sizeof(buf), "지금 공부 중 · %s", subj);
    else if (smin) snprintf(buf, sizeof(buf), "오늘 %d분", smin);
    else snprintf(buf, sizeof(buf), "아직 안 했어요");
    tile(tiles, "공부", buf, study && !active);
    int entries = 0, pages = reading_pages(log, &entries);
    if (entries) snprintf(buf, sizeof(buf), "오늘 %d쪽", pages); else snprintf(buf, sizeof(buf), "아직 안 했어요");
    tile(tiles, "독서", buf, entries > 0);
    tile(tiles, "필사", copy ? "오늘 했어요" : "아직 안 했어요", copy);
    static chore_t chores[CHORE_MAX];
    int nc = chores_today(st->cfg, st->kid_ids[k], t, chores, CHORE_MAX), cd = 0;
    for (int i = 0; i < nc; i++) if (chore_done(log, chores[i].id)) cd++;
    if (nc) snprintf(buf, sizeof(buf), "%d / %d", cd, nc); else snprintf(buf, sizeof(buf), "오늘은 없어요");
    tile(tiles, "집안일", buf, nc && cd == nc);

    if (nc) { // 집안일 체크
        lv_obj_t *wrap = box(p, LV_FLEX_FLOW_ROW_WRAP);
        for (int i = 0; i < nc; i++) {
            act_t *a = new_act(A_CHORE, k);
            if (!a) break;
            snprintf(a->a, sizeof(a->a), "%s", chores[i].id);
            bool on = chore_done(log, chores[i].id);
            a->on = !on;
            chip(wrap, chores[i].title, on, a);
        }
    }

    // 감정 체크인: 오후 3시 전은 아침, 그 뒤는 저녁 (앱 nowSlot과 같음)
    bool pm = t->tm_hour >= 15;
    if (!jget(jget(log, "mood"), pm ? "pm" : "am")) {
        label(p, pm ? "저녁 기분은 어때요?" : "아침 기분은 어때요?", F_BODY, C_TEXT);
        lv_obj_t *row = box(p, LV_FLEX_FLOW_ROW_WRAP);
        for (int i = 0; i < 5; i++) {
            act_t *a = new_act(A_MOOD, k);
            if (!a) break;
            a->v = i;
            a->on = pm;
            button(row, MOOD5[i], F_BODY, C_LINE, C_TEXT, a);
        }
    } else {
        label(p, "기분 체크인 했어요", F_SMALL, C_QUIET);
    }
}

// ---------- 밤 ----------
static void build_night(board_state_t *st, const struct tm *t)
{
    lv_obj_clean(s_top);
    lv_obj_t *c = box(s_main, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_height(c, LV_PCT(100));
    lv_obj_set_flex_align(c, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    char buf[96];
    snprintf(buf, sizeof(buf), "%02d:%02d", t->tm_hour, t->tm_min);
    label(c, buf, F_HUGE, C_QUIET);
    snprintf(buf, sizeof(buf), "%d월 %d일 %s요일", t->tm_mon + 1, t->tm_mday, WD[t->tm_wday]);
    label(c, buf, F_BODY, C_QUIET);
    for (int k = 0; k < st->n_kids; k++) {
        const cJSON *log = st->logs[k];
        int n = 0;
        char line[160];
        size_t o = snprintf(line, sizeof(line), "%s: ", kid_name(st, k));
        if (completed_at(log, MODE_MORNING)) o += snprintf(line + o, sizeof(line) - o, "%s등교 준비", n++ ? " · " : "");
        if (study_minutes(log, NULL, NULL, 0)) o += snprintf(line + o, sizeof(line) - o, "%s공부", n++ ? " · " : "");
        int e = 0;
        reading_pages(log, &e);
        if (e) o += snprintf(line + o, sizeof(line) - o, "%s독서", n++ ? " · " : "");
        if (copy_done(log)) o += snprintf(line + o, sizeof(line) - o, "%s필사", n++ ? " · " : "");
        if (completed_at(log, MODE_EVENING)) o += snprintf(line + o, sizeof(line) - o, "%s내일 준비", n++ ? " · " : "");
        if (!n) snprintf(line + o, sizeof(line) - o, "푹 쉬어요");
        label(c, line, F_BODY, C_QUIET);
    }
    act_t *a = new_act(A_WAKE, 0);
    lv_obj_add_flag(c, LV_OBJ_FLAG_CLICKABLE);
    if (a) lv_obj_add_event_cb(c, on_click, LV_EVENT_CLICKED, a);
}

// ---------- 초대 코드 ----------
static void build_join(board_state_t *st)
{
    lv_obj_clean(s_top);
    label(s_top, "관제 센터 보드 연결", F_TITLE, C_TEXT);
    lv_obj_t *c = box(s_main, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_all(c, 24, 0);
    label(c, "부모님 앱 → 가족 연결 → \"보드 초대 코드 만들기\"에서 나온 8자리 코드를 넣어 주세요.", F_BODY, C_TEXT);
    s_join_ta = lv_textarea_create(c);
    lv_textarea_set_one_line(s_join_ta, true);
    lv_textarea_set_max_length(s_join_ta, 10);
    lv_obj_set_width(s_join_ta, LV_PCT(100));
    lv_obj_set_style_text_font(s_join_ta, F_BIG, 0);
    act_t *a = new_act(A_JOIN, 0);
    lv_obj_t *b = button(c, st->joining ? "연결하는 중…" : "연결하기", F_TITLE, C_ION, C_BG, a);
    if (st->joining) lv_obj_add_state(b, LV_STATE_DISABLED);
    if (st->join_msg[0]) label(c, st->join_msg, F_BODY, C_MORNING);
    if (!net_up()) label(c, "Wi-Fi에 연결하는 중이에요…", F_SMALL, C_QUIET);
    lv_obj_t *kb = lv_keyboard_create(s_main);
    lv_keyboard_set_mode(kb, LV_KEYBOARD_MODE_TEXT_UPPER);
    lv_keyboard_set_textarea(kb, s_join_ta);
    lv_obj_set_size(kb, LV_PCT(100), 420);
    lv_obj_align(kb, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_add_flag(kb, LV_OBJ_FLAG_IGNORE_LAYOUT);
}

// ---------- 전체 ----------
static void rebuild(void)
{
    s_n_acts = 0;
    s_join_ta = NULL;
    lv_obj_clean(s_main);
    struct tm t;
    now_tm(&t);
    board_state_t *st = sync_lock();
    s_seen_version = st->version;
    s_seen_minute = t.tm_hour * 60 + t.tm_min;

    if (st->need_join) { build_join(st); sync_unlock(); hw_backlight(70); return; }
    if (!st->cfg || !net_time_ok()) {
        build_top(st, &t);
        label(s_main, net_up() ? "기록을 불러오는 중…" : "Wi-Fi에 연결하는 중…", F_BODY, C_QUIET);
        sync_unlock();
        return;
    }
    bool awake = esp_timer_get_time() < s_wake_until;
    if (is_night(st->cfg, &t) && !awake) {
        build_night(st, &t);
        sync_unlock();
        hw_backlight(8);
        return;
    }
    hw_backlight(70);
    build_top(st, &t);
    app_mode_t mode = auto_mode(st->cfg, &t);
    for (int k = 0; k < st->n_kids && k < 2; k++) { // 세로 화면에 두 칸
        lv_obj_t *p = lv_obj_create(s_main);
        lv_obj_set_size(p, LV_PCT(100), LV_PCT(49));
        lv_obj_set_style_bg_color(p, lv_color_hex(C_PANEL), 0);
        lv_obj_set_style_border_color(p, lv_color_hex(C_LINE), 0);
        lv_obj_set_style_border_width(p, 1, 0);
        lv_obj_set_style_radius(p, 20, 0);
        lv_obj_set_style_pad_all(p, 20, 0);
        lv_obj_set_flex_flow(p, LV_FLEX_FLOW_COLUMN);
        lv_obj_set_style_pad_gap(p, 12, 0);
        if (mode == MODE_REST) build_rest(p, st, k, &t);
        else build_routine(p, st, k, mode, &t);
    }
    sync_unlock();
}

// ---------- 누름 처리 ----------
static void on_click(lv_event_t *e)
{
    act_t *a = lv_event_get_user_data(e);
    if (!a) return;
    struct tm t;
    now_tm(&t);
    int64_t ms = now_ms();

    if (a->kind == A_WAKE) { s_wake_until = esp_timer_get_time() + 30LL * 1000000; s_dirty = true; return; }
    if (a->kind == A_JOIN) {
        if (s_join_ta) sync_request_join(lv_textarea_get_text(s_join_ta));
        s_dirty = true;
        return;
    }
    if (a->kind == A_REVIEW) { s_review[a->kid] = a->on; s_card[a->kid] = 0; s_dirty = true; return; }
    if (a->kind == A_PREV) { if (s_card[a->kid] > 0) s_card[a->kid]--; s_dirty = true; return; }

    static log_patch_t p;
    board_state_t *st = sync_lock();
    if (a->kid >= st->n_kids || !st->cfg) { sync_unlock(); return; }
    int k = a->kid;
    const char *kid = st->kid_ids[k];
    app_mode_t mode = auto_mode(st->cfg, &t);
    char date[11];
    date_key(&t, date);
    patch_init(&p, date, kid);
    const cJSON *log = strcmp(st->date, date) ? NULL : st->logs[k];

    switch (a->kind) {
    case A_TICK: act_step(st->cfg, log, kid, mode, &t, a->a, a->on, true, ms, &p); break;
    case A_MINI: act_item(st->cfg, log, kid, mode, &t, a->a, a->b, a->on, true, ms, &p); break;
    case A_ITEM: act_item(st->cfg, log, kid, mode, &t, a->a, a->b, a->on, false, ms, &p); break;
    case A_DONE: act_step(st->cfg, log, kid, mode, &t, a->a, true, false, ms, &p); break;
    case A_CHORE: act_chore(a->a, a->on, ms, &p); break;
    case A_MOOD: act_mood(a->on, a->v, ms, &p); break;
    default: break;
    }
    sync_unlock();
    if (p.n) sync_submit(&p);
    patch_free(&p);

    if (a->kind == A_DONE || a->kind == A_NEXT) {
        // 다음 안 한 단계로 (app.js의 done/next와 같은 순서)
        st = sync_lock();
        static rt_step_t steps[RT_MAX_STEPS];
        int n = routine_steps(st->cfg, kid, mode, &t, steps, RT_MAX_STEPS);
        const cJSON *lg = st->logs[k];
        int idx = s_card[k] < 0 ? 0 : s_card[k], nx = -1;
        for (int i = idx + 1; i < n && nx < 0; i++) if (!step_done(lg, mode, steps[i].id)) nx = i;
        for (int i = 0; i < n && nx < 0; i++) if (!step_done(lg, mode, steps[i].id)) nx = i;
        s_card[k] = nx < 0 ? (idx + 1 < n ? idx + 1 : n - 1) : nx;
        sync_unlock();
    }
    s_dirty = true;
}

static void tick(lv_timer_t *tm)
{
    (void)tm;
    struct tm t;
    now_tm(&t);
    board_state_t *st = sync_lock();
    uint32_t v = st->version;
    sync_unlock();
    int minute = t.tm_hour * 60 + t.tm_min;
    // 초대 코드 화면에서는 시계 때문에 다시 그리지 않는다 (치던 코드가 지워지지 않게)
    if (s_join_ta && !s_dirty && v == s_seen_version) return;
    if (s_dirty || v != s_seen_version || minute != s_seen_minute) {
        s_dirty = false;
        rebuild();
    }
}

void ui_start(lv_display_t *disp)
{
    F_SMALL = lv_tiny_ttf_create_data(font_reg_start, font_reg_end - font_reg_start, 22);
    F_BODY = lv_tiny_ttf_create_data(font_reg_start, font_reg_end - font_reg_start, 28);
    F_TITLE = lv_tiny_ttf_create_data(font_bold_start, font_bold_end - font_bold_start, 34);
    F_BIG = lv_tiny_ttf_create_data(font_bold_start, font_bold_end - font_bold_start, 48);
    F_HUGE = lv_tiny_ttf_create_data(font_bold_start, font_bold_end - font_bold_start, 160);
    // 체크 표시 같은 기호는 LVGL 기본 글꼴에서 빌려 온다
    F_SMALL->fallback = &lv_font_montserrat_22;
    F_BODY->fallback = &lv_font_montserrat_28;
    F_TITLE->fallback = &lv_font_montserrat_34;
    F_BIG->fallback = &lv_font_montserrat_48;
    F_HUGE->fallback = &lv_font_montserrat_48;

    lv_obj_t *scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_hex(C_BG), 0);
    lv_obj_set_style_text_font(scr, F_BODY, 0);
    lv_obj_set_flex_flow(scr, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_all(scr, 16, 0);
    lv_obj_set_style_pad_gap(scr, 12, 0);

    s_top = box(scr, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_gap(s_top, 4, 0);
    s_main = box(scr, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_grow(s_main, 1);
    lv_obj_set_style_pad_gap(s_main, 12, 0);

    lv_timer_create(tick, 500, NULL);
    rebuild();
}
