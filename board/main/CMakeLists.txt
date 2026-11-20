set(reqs nvs_flash esp_http_client esp_netif esp_wifi esp_timer esp_driver_i2c esp_driver_ledc esp_lcd mbedtls)
if(IDF_VERSION_MAJOR LESS 6)
    list(APPEND reqs json)   # ESP-IDF 5.x에는 cJSON이 들어 있음 (6.x는 idf_component.yml의 espressif/cjson)
endif()

idf_component_register(
    SRCS "main.c" "hw.c" "net.c" "cloud.c" "sync.c" "ui.c" "model.c" "fs_json.c" "ikey.c"
    INCLUDE_DIRS "."
    EMBED_FILES "fonts/board_sans_regular.ttf" "fonts/board_sans_semibold.ttf"
    PRIV_REQUIRES ${reqs}
)
# 화면 글자는 칸이 모자라면 잘라 쓰도록 만들었으므로, 잘림 가능성 경고는 빌드를 멈추지 않게 한다
target_compile_options(${COMPONENT_LIB} PRIVATE -Wno-error=format-truncation)
