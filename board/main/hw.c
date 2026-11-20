// hw.c — 화면과 터치 켜기
//
// 핀과 부품 (공개된 커뮤니티 자료 기준 — 보드 판(revision)에 따라 다를 수 있음)
//   화면: JD9365, MIPI-DSI 2레인, 800×1280 세로, 리셋 GPIO 27
//         배치 2624 이후(스티커의 괄호 숫자) 제품은 V2 패널 → jc8012_v2_init.h
//   터치: GSL3680, I2C SDA 7 / SCL 8, RST 22 / INT 21, 주소 0x40
//   백라이트: GPIO 23 PWM
//   MIPI-DSI PHY 전원: 칩 안의 LDO 3번 채널 2.5V
#include "hw.h"
#include "driver/i2c_master.h"
#include "driver/ledc.h"
#include "esp_idf_version.h"
#include "esp_lcd_jd9365.h"
#include "esp_lcd_mipi_dsi.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_touch_gsl3680.h"
#include "esp_ldo_regulator.h"
#include "esp_log.h"
#include "esp_lvgl_port.h"
#include "jc8012_v2_init.h"

static const char *TAG = "hw";

#define LCD_H_RES 800
#define LCD_V_RES 1280
#define PIN_LCD_RST 27
#define PIN_BL 23
#define PIN_TP_SDA 7
#define PIN_TP_SCL 8
#define PIN_TP_RST 22
#define PIN_TP_INT 21

// 누를 때마다 좌표를 로그에 찍는다 (터치가 들어오는지, 방향이 맞는지 확인용)
static void touch_log(lv_event_t *e)
{
    lv_point_t p;
    lv_indev_get_point(lv_event_get_indev(e), &p);
    ESP_LOGI(TAG, "터치 x=%d y=%d", (int)p.x, (int)p.y);
}

static void backlight_init(void)
{
    ledc_timer_config_t t = {
        .speed_mode = LEDC_LOW_SPEED_MODE, .duty_resolution = LEDC_TIMER_10_BIT,
        .timer_num = LEDC_TIMER_0, .freq_hz = 20000, .clk_cfg = LEDC_AUTO_CLK,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&t));
    ledc_channel_config_t c = {
        .gpio_num = PIN_BL, .speed_mode = LEDC_LOW_SPEED_MODE, .channel = LEDC_CHANNEL_0,
        .timer_sel = LEDC_TIMER_0, .duty = 0, .hpoint = 0,
    };
    ESP_ERROR_CHECK(ledc_channel_config(&c));
}

void hw_backlight(int percent)
{
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, 1023 * percent / 100);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
}

lv_display_t *hw_init(void)
{
    backlight_init();

    // 1. MIPI-DSI PHY 전원
    esp_ldo_channel_handle_t ldo = NULL;
    esp_ldo_channel_config_t ldo_cfg = { .chan_id = 3, .voltage_mv = 2500 };
    ESP_ERROR_CHECK(esp_ldo_acquire_channel(&ldo_cfg, &ldo));

    // 2. DSI 버스와 JD9365 패널
    esp_lcd_dsi_bus_handle_t dsi_bus = NULL;
    esp_lcd_dsi_bus_config_t bus_cfg = JD9365_PANEL_BUS_DSI_2CH_CONFIG();
    ESP_ERROR_CHECK(esp_lcd_new_dsi_bus(&bus_cfg, &dsi_bus));

    esp_lcd_panel_io_handle_t io = NULL;
    esp_lcd_dbi_io_config_t dbi_cfg = JD9365_PANEL_IO_DBI_CONFIG();
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_dbi(dsi_bus, &dbi_cfg, &io));

    // V2 패널 타이밍 (부품 기본값 80MHz·vsync 12/30과 다름)
    esp_lcd_dpi_panel_config_t dpi_cfg = {
        .dpi_clk_src = MIPI_DSI_DPI_CLK_SRC_DEFAULT,
        .dpi_clock_freq_mhz = 70,
        .virtual_channel = 0,
#if ESP_IDF_VERSION < ESP_IDF_VERSION_VAL(6, 0, 0)
        .pixel_format = LCD_COLOR_PIXEL_FORMAT_RGB565,
#else
        .in_color_format = LCD_COLOR_FMT_RGB565,
#endif
        .num_fbs = 1,
        .video_timing = {
            .h_size = LCD_H_RES, .v_size = LCD_V_RES,
            .hsync_pulse_width = 20, .hsync_back_porch = 20, .hsync_front_porch = 40,
            .vsync_pulse_width = 4, .vsync_back_porch = 10, .vsync_front_porch = 20,
        },
    };
    jd9365_vendor_config_t vendor = {
        .init_cmds = JC8012_V2_INIT_CMDS,
        .init_cmds_size = sizeof(JC8012_V2_INIT_CMDS) / sizeof(JC8012_V2_INIT_CMDS[0]),
        .mipi_config = { .dsi_bus = dsi_bus, .dpi_config = &dpi_cfg, .lane_num = 2 },
    };
    esp_lcd_panel_dev_config_t panel_cfg = {
        .reset_gpio_num = PIN_LCD_RST,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
        .vendor_config = &vendor,
    };
    esp_lcd_panel_handle_t panel = NULL;
    ESP_ERROR_CHECK(esp_lcd_new_panel_jd9365(io, &panel_cfg, &panel));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel, true));

    // 3. LVGL
    lvgl_port_cfg_t port_cfg = ESP_LVGL_PORT_INIT_CONFIG();
    port_cfg.task_stack = 16384;
    port_cfg.task_affinity = 1;
    ESP_ERROR_CHECK(lvgl_port_init(&port_cfg));
    lvgl_port_display_cfg_t disp_cfg = {
        .io_handle = io,
        .panel_handle = panel,
        .buffer_size = LCD_H_RES * 160,
        .double_buffer = true,
        .hres = LCD_H_RES,
        .vres = LCD_V_RES,
        .color_format = LV_COLOR_FORMAT_RGB565,
        .flags = { .buff_spiram = true },
    };
    lvgl_port_display_dsi_cfg_t dsi_cfg = { .flags = { .avoid_tearing = false } };
    lv_display_t *disp = lvgl_port_add_disp_dsi(&disp_cfg, &dsi_cfg);

    // 4. 터치
    i2c_master_bus_handle_t i2c = NULL;
    i2c_master_bus_config_t i2c_cfg = {
        .i2c_port = I2C_NUM_1, .sda_io_num = PIN_TP_SDA, .scl_io_num = PIN_TP_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT, .glitch_ignore_cnt = 7, .flags.enable_internal_pullup = true,
    };
    ESP_ERROR_CHECK(i2c_new_master_bus(&i2c_cfg, &i2c));
    esp_lcd_panel_io_handle_t tp_io = NULL;
    esp_lcd_panel_io_i2c_config_t tp_io_cfg = ESP_LCD_TOUCH_IO_I2C_GSL3680_CONFIG();
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_i2c(i2c, &tp_io_cfg, &tp_io));
    // INT 핀을 주면 LVGL이 '인터럽트가 올 때만 읽기'로 바뀌는데, 이 보드(2026년 판)는 INT 없이
    // 주기적으로 읽어야 터치가 들어온다는 사례가 있어 읽기 방식으로 둔다 (PIN_TP_INT는 쓰지 않음)
    esp_lcd_touch_config_t tp_cfg = {
        .x_max = LCD_H_RES, .y_max = LCD_V_RES,
        .rst_gpio_num = PIN_TP_RST, .int_gpio_num = GPIO_NUM_NC,
        .levels = { .reset = 0, .interrupt = 0 },
        .flags = { .mirror_x = true },
    };
    esp_lcd_touch_handle_t tp = NULL;
    esp_err_t terr = esp_lcd_touch_new_i2c_gsl3680(tp_io, &tp_cfg, &tp);
    if (terr == ESP_OK) {
        lvgl_port_touch_cfg_t tc = { .disp = disp, .handle = tp };
        lv_indev_t *indev = lvgl_port_add_touch(&tc);
        if (indev && lvgl_port_lock(0)) {
            lv_indev_add_event_cb(indev, touch_log, LV_EVENT_PRESSED, NULL);
            lvgl_port_unlock();
        }
        ESP_LOGI(TAG, "터치 켜짐 (GSL3680, 주기적으로 읽기)");
    } else {
        ESP_LOGE(TAG, "터치를 켜지 못했어요 (%s) — 화면만 보여 줍니다", esp_err_to_name(terr));
    }

    hw_backlight(70);
    return disp;
}
