// main.c — 관제 센터 보드: 화면을 켜고, Wi-Fi·로그인·동기화를 시작한다
#include "cloud.h"
#include "esp_log.h"
#include "esp_lvgl_port.h"
#include "hw.h"
#include "net.h"
#include "nvs_flash.h"
#include "sync.h"
#include "ui.h"

void app_main(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    lv_display_t *disp = hw_init();
    cloud_init();
    sync_start();
    if (lvgl_port_lock(0)) {
        ui_start(disp);
        lvgl_port_unlock();
    }
    net_start();
    ESP_LOGI("main", "관제 센터 보드 시작");
}
