#include <inttypes.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "esp_check.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#define SOUNDING_MAGIC 0x31444E53u /* SND1, little-endian on wire */
#define SOUNDING_VERSION 1u
#define IEEE80211_NON_QOS_DATA 0x0008u

static const char *TAG = "scanit-wifi-sounding";
static atomic_uint_fast32_t s_tx_completed;
static atomic_uint_fast32_t s_tx_failed;
static uint8_t s_source_mac[6];

typedef struct __attribute__((packed)) {
    uint16_t frame_control;
    uint16_t duration;
    uint8_t destination[6];
    uint8_t source[6];
    uint8_t bssid[6];
    uint16_t sequence_control;
} ieee80211_data_header_t;

typedef struct __attribute__((packed)) {
    uint32_t magic;
    uint16_t version;
    uint16_t payload_bytes;
    uint32_t session_nonce;
    uint32_t sounding_id;
    int64_t tx_monotonic_us;
    uint16_t channel;
    uint16_t sounding_rate_hz;
    uint8_t reserved[16];
    uint32_t crc32;
} scanit_sounding_payload_t;

typedef struct __attribute__((packed)) {
    ieee80211_data_header_t header;
    scanit_sounding_payload_t payload;
} scanit_sounding_frame_t;

static uint32_t crc32_ieee(const uint8_t *data, size_t length)
{
    uint32_t crc = 0xFFFFFFFFu;
    for (size_t index = 0; index < length; index++) {
        crc ^= data[index];
        for (unsigned bit = 0; bit < 8; bit++) {
            const uint32_t mask = (uint32_t)-(int32_t)(crc & 1u);
            crc = (crc >> 1) ^ (0xEDB88320u & mask);
        }
    }
    return ~crc;
}

static void tx_done_callback(const esp_80211_tx_info_t *tx_info)
{
    if (tx_info == NULL) {
        atomic_fetch_add_explicit(&s_tx_failed, 1, memory_order_relaxed);
        return;
    }
    atomic_fetch_add_explicit(&s_tx_completed, 1, memory_order_relaxed);
}

static void build_sounding_frame(scanit_sounding_frame_t *frame, uint32_t sounding_id)
{
    memset(frame, 0, sizeof(*frame));
    frame->header.frame_control = IEEE80211_NON_QOS_DATA;
    memset(frame->header.destination, 0xFF, sizeof(frame->header.destination));
    memcpy(frame->header.source, s_source_mac, sizeof(frame->header.source));
    memcpy(frame->header.bssid, s_source_mac, sizeof(frame->header.bssid));
    frame->header.sequence_control = (uint16_t)((sounding_id & 0x0FFFu) << 4);

    frame->payload.magic = SOUNDING_MAGIC;
    frame->payload.version = SOUNDING_VERSION;
    frame->payload.payload_bytes = sizeof(frame->payload);
    frame->payload.session_nonce = CONFIG_SCANIT_SOUNDING_SESSION_NONCE;
    frame->payload.sounding_id = sounding_id;
    frame->payload.tx_monotonic_us = esp_timer_get_time();
    frame->payload.channel = CONFIG_SCANIT_SOUNDING_CHANNEL;
    frame->payload.sounding_rate_hz = CONFIG_SCANIT_SOUNDING_RATE_HZ;
    frame->payload.crc32 = crc32_ieee(
        (const uint8_t *)&frame->payload,
        offsetof(scanit_sounding_payload_t, crc32)
    );
}

static void sounding_task(void *argument)
{
    (void)argument;
    const TickType_t interval = pdMS_TO_TICKS(
        1000 / CONFIG_SCANIT_SOUNDING_RATE_HZ
    );
    TickType_t wake = xTaskGetTickCount();
    uint32_t sounding_id = 0;

    while (true) {
        scanit_sounding_frame_t frame;
        build_sounding_frame(&frame, sounding_id);
        const esp_err_t result = esp_wifi_80211_tx(
            WIFI_IF_STA,
            &frame,
            sizeof(frame),
            false
        );
        if (result != ESP_OK) {
            atomic_fetch_add_explicit(&s_tx_failed, 1, memory_order_relaxed);
        }

        sounding_id++;
        if ((sounding_id % 200u) == 0u) {
            ESP_LOGI(
                TAG,
                "soundings=%" PRIu32 " tx_done=%" PRIuFAST32 " tx_failed=%" PRIuFAST32,
                sounding_id,
                atomic_load_explicit(&s_tx_completed, memory_order_relaxed),
                atomic_load_explicit(&s_tx_failed, memory_order_relaxed)
            );
        }
        vTaskDelayUntil(&wake, interval);
    }
}

static esp_err_t initialise_wifi(void)
{
    ESP_RETURN_ON_ERROR(esp_netif_init(), TAG, "netif init");
    ESP_RETURN_ON_ERROR(esp_event_loop_create_default(), TAG, "event loop");

    wifi_init_config_t wifi_config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_wifi_init(&wifi_config), TAG, "wifi init");
    ESP_RETURN_ON_ERROR(esp_wifi_set_storage(WIFI_STORAGE_RAM), TAG, "wifi storage");
    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_STA), TAG, "wifi mode");
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "wifi start");
    ESP_RETURN_ON_ERROR(esp_wifi_set_country_code("SE", true), TAG, "country code");
    ESP_RETURN_ON_ERROR(
        esp_wifi_set_bandwidth(WIFI_IF_STA, WIFI_BW_HT20),
        TAG,
        "HT20 bandwidth"
    );
    ESP_RETURN_ON_ERROR(
        esp_wifi_set_channel(CONFIG_SCANIT_SOUNDING_CHANNEL, WIFI_SECOND_CHAN_NONE),
        TAG,
        "sounding channel"
    );
    ESP_RETURN_ON_ERROR(esp_wifi_get_mac(WIFI_IF_STA, s_source_mac), TAG, "read MAC");
    ESP_RETURN_ON_ERROR(
        esp_wifi_register_80211_tx_cb(tx_done_callback),
        TAG,
        "TX callback"
    );
    return ESP_OK;
}

void app_main(void)
{
    esp_err_t nvs_result = nvs_flash_init();
    if (nvs_result == ESP_ERR_NVS_NO_FREE_PAGES ||
        nvs_result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    } else {
        ESP_ERROR_CHECK(nvs_result);
    }

    ESP_ERROR_CHECK(initialise_wifi());
    ESP_LOGI(
        TAG,
        "controlled SND1 sounding started on channel %d at %d Hz",
        CONFIG_SCANIT_SOUNDING_CHANNEL,
        CONFIG_SCANIT_SOUNDING_RATE_HZ
    );
    xTaskCreate(sounding_task, "scanit-sounding", 4096, NULL, 5, NULL);
}
