// main.c — 관제 센터 보드: 화면을 켜고, Wi-Fi·로그인·동기화를 시작한다
#include "cJSON.h"
#include "cloud.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_lvgl_port.h"
#include "hw.h"
#include "net.h"
#include "nvs_flash.h"
#include "sync.h"
#include "ui.h"

// 설정·기록 JSON은 작은 조각이 많아서 기본 malloc이면 내부 RAM(작음)에 들어간다.
// 내부 RAM이 모자라면 Wi-Fi(C6 연결)가 패킷 버퍼를 못 잡아 연결이 끊긴다 → 큰 PSRAM에 둔다.
static void *json_malloc(size_t n)
{
    void *p = heap_caps_malloc(n, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    return p ? p : malloc(n);
}

void app_main(void)
{
    cJSON_Hooks hooks = { .malloc_fn = json_malloc, .free_fn = free };
    cJSON_InitHooks(&hooks);

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
