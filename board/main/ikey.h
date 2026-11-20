// ikey.h — 확인 목록 항목의 키 (앱 app.js의 ikey()와 똑같이 계산)
#pragma once
#include <stddef.h>
#include <stdint.h>

// 글자(UTF-8)를 UTF-16 단위로 돌며 djb2 해시. JS의 charCodeAt 기준과 같다.
uint32_t ikey_hash(const char *utf8);

// out = 단계ID + "_" + 해시의 36진수 (예: "m5_1x2abc")
void ikey(const char *step_id, const char *text, char *out, size_t out_len);
