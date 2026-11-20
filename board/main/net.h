// net.h — Wi-Fi(ESP32-C6를 통해)와 시각 맞추기
#pragma once
#include <stdbool.h>

void net_start(void);
bool net_up(void);        // IP를 받았는지
bool net_time_ok(void);   // SNTP로 시각을 맞췄는지 (HTTPS 인증서 검사와 날짜에 필요)
