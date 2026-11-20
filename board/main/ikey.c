// ikey.c — 앱의 ikey(stepId, text)와 같은 결과를 내야 보드와 폰의 체크가 같은 칸을 가리킨다.
//
//   function ikey(stepId, text) {
//     let h = 5381; const s = String(text);
//     for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
//     return stepId + '_' + h.toString(36);
//   }
//
// JS 문자열은 UTF-16이므로 한글은 코드포인트 그대로, 이모지 같은 큰 글자는 대리 쌍 두 개로 센다.
// (h << 5)는 JS에서 32비트 정수 연산이고 >>> 0 으로 부호 없는 값이 되므로 uint32 넘침과 같다.
#include "ikey.h"
#include <stdio.h>
#include <string.h>

// UTF-8 한 글자를 읽어 코드포인트를 돌려주고 p를 앞으로 옮긴다. 잘못된 바이트는 U+FFFD.
static uint32_t next_cp(const unsigned char **p)
{
    const unsigned char *s = *p;
    uint32_t c = s[0];
    int n = 0;
    if (c < 0x80) { *p = s + 1; return c; }
    if ((c & 0xE0) == 0xC0) { c &= 0x1F; n = 1; }
    else if ((c & 0xF0) == 0xE0) { c &= 0x0F; n = 2; }
    else if ((c & 0xF8) == 0xF0) { c &= 0x07; n = 3; }
    else { *p = s + 1; return 0xFFFD; }
    for (int i = 1; i <= n; i++) {
        if ((s[i] & 0xC0) != 0x80) { *p = s + i; return 0xFFFD; }
        c = (c << 6) | (s[i] & 0x3F);
    }
    *p = s + n + 1;
    return c;
}

uint32_t ikey_hash(const char *utf8)
{
    uint32_t h = 5381;
    const unsigned char *p = (const unsigned char *)(utf8 ? utf8 : "");
    while (*p) {
        uint32_t cp = next_cp(&p);
        if (cp >= 0x10000) {
            cp -= 0x10000;
            h = (h << 5) + h + (0xD800 + (cp >> 10));
            h = (h << 5) + h + (0xDC00 + (cp & 0x3FF));
        } else {
            h = (h << 5) + h + cp;
        }
    }
    return h;
}

void ikey(const char *step_id, const char *text, char *out, size_t out_len)
{
    static const char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";
    char b36[16];
    int n = 0;
    uint32_t h = ikey_hash(text);
    do { b36[n++] = digits[h % 36]; h /= 36; } while (h && n < (int)sizeof(b36));
    char rev[16];
    for (int i = 0; i < n; i++) rev[i] = b36[n - 1 - i];
    rev[n] = 0;
    snprintf(out, out_len, "%s_%s", step_id ? step_id : "", rev);
}
