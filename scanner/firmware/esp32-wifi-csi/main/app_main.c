#include <inttypes.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_check.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#define CSI_QUEUE_DEPTH 24
#define CSI_MAX_BYTES 512
#define CSI_RECORD_MAGIC 0x30495343u /* CSI0, little-endian on wire */
#define CSI_RECORD_VERSION 1u

static const char *TAG = "scanit-wifi-csi";
static QueueHandle_t s_csi_queue;
static uint32_t s_sequence;

/*
 * This is the MCU-to-gateway ingress record, not WCS1. The gateway resolves
 * the PHY-specific subcarrier map, converts int8 [imag, real] samples into
 * Float32 complex values and emits the audited WCS1 packet used by the app.
 */
typedef struct __attribute__((packed)) {
    uint32_t magic;
    uint16_t version;
    uint16_t header_bytes;
    uint32_t sequence;
    int64_t monotonic_timestamp_us;
    uint8_t source_mac[6];
    int8_t rssi_dbm;
    int8_t noise_floor_dbm;
    uint8_t channel;
    uint8_t secondary_channel;
    uint8_t antenna;
    uint8_t mcs;
    uint8_t bandwidth_40mhz;
    uint8_t first_word_invalid;
    uint16_t payload_bytes;
} csi_record_header_t;

typedef struct {
    csi_record_header_t header;
    uint8_t payload[CSI_MAX_BYTES];
} queued_csi_record_t;

static void csi_rx_callback(void *ctx, wifi_csi_info_t *info)
{
    (void)ctx;
    if (info == NULL || info->buf == NULL || info->len == 0 || s_csi_queue == NULL) {
        return;
    }

    queued_csi_record_t record = {0};
    record.header.magic = CSI_RECORD_MAGIC;
    record.header.version = CSI_RECORD_VERSION;
    record.header.header_bytes = sizeof(csi_record_header_t);
    record.header.sequence = s_sequence++;
    record.header.monotonic_timestamp_us = esp_timer_get_time();
    memcpy(record.header.source_mac, info->mac, sizeof(record.header.source_mac));
    record.header.rssi_dbm = info->rx_ctrl.rssi;
    record.header.noise_floor_dbm = info->rx_ctrl.noise_floor;
    record.header.channel = info->rx_ctrl.channel;
    record.header.secondary_channel = info->rx_ctrl.secondary_channel;
    record.header.antenna = info->rx_ctrl.ant;
    record.header.mcs = info->rx_ctrl.mcs;
    record.header.bandwidth_40mhz = info->rx_ctrl.cwb;
    record.header.first_word_invalid = info->first_word_invalid ? 1u : 0u;
    record.header.payload_bytes = info->len > CSI_MAX_BYTES ? CSI_MAX_BYTES : info->len;
    memcpy(record.payload, info->buf, record.header.payload_bytes);

    /* The callback runs in the Wi-Fi driver task. Never block or serialize here. */
    (void)xQueueSend(s_csi_queue, &record, 0);
}

static void write_record_to_gateway(const queued_csi_record_t *record)
{
    /*
     * Reference transport: binary header + payload on USB/JTAG serial or a
     * dedicated UART. Replace these two writes with the selected transport;
     * keep record boundaries and the monotonic timestamp unchanged.
     */
    fwrite(&record->header, 1, sizeof(record->header), stdout);
    fwrite(record->payload, 1, record->header.payload_bytes, stdout);
    fflush(stdout);
}

static void csi_writer_task(void *argument)
{
    (void)argument;
    queued_csi_record_t record;
    while (true) {
        if (xQueueReceive(s_csi_queue, &record, portMAX_DELAY) == pdTRUE) {
            write_record_to_gateway(&record);
        }
    }
}

static esp_err_t configure_csi(void)
{
#if CONFIG_SOC_WIFI_HE_SUPPORT
    wifi_csi_config_t configuration = {
        .enable = true,
        .acquire_csi_legacy = true,
        .acquire_csi_ht20 = true,
        .acquire_csi_ht40 = true,
        .acquire_csi_su = true,
        .acquire_csi_mu = false,
        .acquire_csi_dcm = false,
        .acquire_csi_beamformed = false,
        .acquire_csi_he_stbc = 2,
        .val_scale_cfg = 0,
    };
#else
    wifi_csi_config_t configuration = {
        .lltf_en = true,
        .htltf_en = true,
        .stbc_htltf2_en = true,
        .ltf_merge_en = true,
        .channel_filter_en = false,
        .manu_scale = false,
        .shift = 0,
    };
#endif

    ESP_RETURN_ON_ERROR(esp_wifi_set_csi_config(&configuration), TAG, "set CSI config");
    ESP_RETURN_ON_ERROR(esp_wifi_set_csi_rx_cb(csi_rx_callback, NULL), TAG, "set CSI callback");
    ESP_RETURN_ON_ERROR(esp_wifi_set_csi(true), TAG, "enable CSI");
    return ESP_OK;
}

static esp_err_t initialise_wifi_for_csi(void)
{
    ESP_RETURN_ON_ERROR(esp_netif_init(), TAG, "netif init");
    ESP_RETURN_ON_ERROR(esp_event_loop_create_default(), TAG, "event loop");
    wifi_init_config_t wifi_config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(esp_wifi_init(&wifi_config), TAG, "wifi init");
    ESP_RETURN_ON_ERROR(esp_wifi_set_storage(WIFI_STORAGE_RAM), TAG, "wifi storage");
    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_NULL), TAG, "wifi null mode");
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "wifi start");
    ESP_RETURN_ON_ERROR(esp_wifi_set_promiscuous(true), TAG, "promiscuous mode");
    return configure_csi();
}

void app_main(void)
{
    esp_err_t nvs_result = nvs_flash_init();
    if (nvs_result == ESP_ERR_NVS_NO_FREE_PAGES || nvs_result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    } else {
        ESP_ERROR_CHECK(nvs_result);
    }

    s_csi_queue = xQueueCreate(CSI_QUEUE_DEPTH, sizeof(queued_csi_record_t));
    if (s_csi_queue == NULL) {
        ESP_LOGE(TAG, "Unable to allocate CSI queue");
        abort();
    }
    xTaskCreate(csi_writer_task, "csi-writer", 6144, NULL, 5, NULL);
    ESP_ERROR_CHECK(initialise_wifi_for_csi());
    ESP_LOGI(TAG, "CSI capture enabled; callback records are queued for the gateway");
}