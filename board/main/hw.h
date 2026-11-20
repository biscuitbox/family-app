// hw.h — Guition JC8012P4A1C 화면(JD9365, MIPI-DSI 2레인), 터치(GSL3680), 백라이트
#pragma once
#include "lvgl.h"

lv_display_t *hw_init(void);   // 화면·터치·LVGL을 켠다
void hw_backlight(int percent); // 0~100
