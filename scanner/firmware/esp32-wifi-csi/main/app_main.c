#include <inttypes.h>
#include <limits.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "driver/uart.h"
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
#define SOUNDING_CACHE_DEPTH 32
#define CSI_RECORD_MAGIC 0x30495343u /* CSI0, little-endian on wire */
#define CSI_RECORD_VERSION 2u
#define SOUNDING_MAGIC 0x31444E53u /* SND1, little-endian on wire */
#define SOUNDING_VERSION 1u
#define IEEE80211_HEADER_BYTES 24u

#define CSI_STATUS_SOUNDING_ID_PRESENT (1u << 0)
#define CSI_STATUS_SOUNDING_CRC_VALID (1u << 1)
#define CSI_STATUS_TIMESTAMP_MATCHED (1u << 2)
#define CSI_STATUS_PAYLOAD_TRUNCATED (1u << 3)
#define CSI_STATUS_QUEUE_DROPS_PRESENT (1u << 4)

static const char *TAG = "scanit-wifi-csi";
static QueueHandle_t s_csi_queue;
static uint32_t s_sequence;
static uint32_t s_queue_drops;
static uint32_t s_marker_misses;
static uint32_t s_records_written;
static portMUX_TYPE s_marker_mux = portMUX_INITIALIZER_UNLOCKED;

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

typedef struct {
    bool valid;
    uint8_t source_mac[6];
    uint32_t rx_driver_timestamp_us;
    uint32_t sounding_id;
    uint32_t session_nonce;
    int64_t tx_monotonic_us;
} sounding_marker_t;

static sounding_marker_t s_markers[SOUNDING_CACHE_DEPTH];
static size_t s_marker_write_index;

typedef struct __attribute__((packed)) {
    uint32_t magic;
    uint16_t version;
    uint16_t header_bytes;
    uint32_t sequence;
    uint32_t sounding_id;
    uint32_t sounding_session_nonce;
    int64_t monotonic_timestamp_us;
    int64_t tx_monotonic_us;
    uint32_t rx_driver_timestamp_us;
    int32_t marker_delta_us;
    uint8_t source_mac[6];
    int8_t rssi_dbm;
    int8_t noise_floor_dbm;
    uint8_t channel;
    uint8_t secondary_channel;
    uint8_t antenna;
    uint8_t mcs;
    uint8_t bandwidth_40mhz;
    uint8_t first_word_invalid;
    uint16_t status_flags;
    uint32_t dropped_total;
    uint16_t payload_bytes;
} csi_record_header_t;

typedef struct {
    csi_record_header_t header;
    uint8_t payload[CSI_MAX_BYTES];
} queued_csi_record_t;

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

static uint32_t timestamp_distance_us(uint32_t left, uint32_t right)
{
    const int32_t signed_delta = (int32_t)(left - right);
    if (signed_delta == INT32_MIN) {
        return UINT32_MAX;
    }
    return (uint32_t)(signed_delta < 0 ? -signed_delta : signed_delta);
}

static void store_sounding_marker(
    const uint8_t source_mac[6],
    uint32_t rx_driver_timestamp_us,
    const scanit_sounding_payload_t *payload
)
{
    portENTER_CRITICAL(&s_marker_mux);
    sounding_marker_t *marker = &s_markers[s_marker_write_index];
    memset(marker, 0, sizeof(*marker));
    marker->valid = true;
    memcpy(marker->source_mac, source_mac, sizeof(marker->source_mac));
    marker->rx_driver_timestamp_us = rx_driver_timestamp_us;
    marker->sounding_id = payload->sounding_id;
    marker->session_nonce = payload->session_nonce;
    marker->tx_monotonic_us = payload->tx_monotonic_us;
    s_marker_write_index = (s_marker_write_index + 1u) % SOUNDING_CACHE_DEPTH;
    portEXIT_CRITICAL(&s_marker_mux);
}

static bool find_sounding_marker(
    const uint8_t source_mac[6],
    uint32_t rx_driver_timestamp_us,
    sounding_marker_t *result,
    int32_t *delta_us
)
{
    bool found = false;
    uint32_t best_distance = UINT32_MAX;
    sounding_marker_t best = {0};

    portENTER_CRITICAL(&s_marker_mux);
    for (size_t index = 0; index < SOUNDING_CACHE_DEPTH; index++) {
        const sounding_marker_t *candidate = &s_markers[index];
        if (!candidate->valid ||
            memcmp(candidate->source_mac, source_mac, sizeof(candidate->source_mac)) != 0) {
            continue;
        }
        const uint32_t distance = timestamp_distance_us(
            candidate->rx_driver_timestamp_us,
            rx_driver_timestamp_us
        );
        if (distance <= CONFIG_SCANIT_CSI_MATCH_WINDOW_US && distance < best_distance) {
            best_distance = distance;
            best = *candidate;
            found = true;
        }
    }
    portEXIT_CRITICAL(&s_marker_mux);

    if (!found) {
        return false;
    }
    *result = best;
    *delta_us = (int32_t)(rx_driver_timestamp_us - best.rx_driver_timestamp_us);
    return true;
}

static void promiscuous_rx_callback(void *buffer, wifi_promiscuous_pkt_type_t type)
{
    if (buffer == NULL || type != WIFI_PKT_DATA) {
        return;
    }
    const wifi_promiscuous_pkt_t *packet = (const wifi_promiscuous_pkt_t *)buffer;
    if (packet->rx_ctrl.sig_len < IEEE80211_HEADER_BYTES + sizeof(scanit_sounding_payload_t)) {
        return;
    }

    const uint8_t *frame = packet->payload;
    const uint16_t frame_control = (uint16_t)frame[0] | ((uint16_t)frame[1] << 8);
    if ((frame_control & 0x00FCu) != 0x0008u) {
        return;
    }

    scanit_sounding_payload_t sounding;
    memcpy(&sounding, frame + IEEE80211_HEADER_BYTES, sizeof(sounding));
    if (sounding.magic != SOUNDING_MAGIC ||
        sounding.version != SOUNDING_VERSION ||
        sounding.payload_bytes != sizeof(sounding) ||
        sounding.channel != CONFIG_SCANIT_CSI_CHANNEL) {
        return;
    }
    const uint32_t expected_crc = crc32_ieee(
        (const uint8_t *)&sounding,
        offsetof(scanit_sounding_payload_t, crc32)
    );
    if (expected_crc != sounding.crc32) {
        return;
    }

    store_sounding_marker(frame + 10, packet->rx_ctrl.timestamp, &sounding);
}

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
    record.header.sounding_id = UINT32_MAX;
    record.header.sounding_session_nonce = 0;
    record.header.monotonic_timestamp_us = esp_timer_get_time();
    record.header.tx_monotonic_us = 0;
    record.header.rx_driver_timestamp_us = info->rx_ctrl.timestamp;
    record.header.marker_delta_us = INT32_MAX;
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
    record.header.dropped_total = s_queue_drops;
    if (info->len > CSI_MAX_BYTES) {
        record.header.status_flags |= CSI_STATUS_PAYLOAD_TRUNCATED;
    }
    if (s_queue_drops > 0) {
        record.header.status_flags |= CSI_STATUS_QUEUE_DROPS_PRESENT;
    }
    memcpy(record.payload, info->buf, record.header.payload_bytes);

    if (xQueueSend(s_csi_queue, &record, 0) != pdTRUE) {
        s_queue_drops++;
    }
}

static bool attach_sounding_identity(queued_csi_record_t *record)
{
    sounding_marker_t marker;
    int32_t delta_us;
    if (!find_sounding_marker(
            record->header.source_mac,
            record->header.rx_driver_timestamp_us,
            &marker,
            &delta_us)) {
        return false;
    }
    record->header.sounding_id = marker.sounding_id;
    record->header.sounding_session_nonce = marker.session_nonce;
    record->header.tx_monotonic_us = marker.tx_monotonic_us;
    record->header.marker_delta_us = delta_us;
    record->header.status_flags |=
        CSI_STATUS_SOUNDING_ID_PRESENT |
        CSI_STATUS_SOUNDING_CRC_VALID |
        CSI_STATUS_TIMESTAMP_MATCHED;
    return true;
}

static void write_record_to_gateway(queued_csi_record_t *record)
{
    if (!attach_sounding_identity(record)) {
        /* Allow the promiscuous callback to finish if callback order was reversed. */
        vTaskDelay(pdMS_TO_TICKS(1));
        if (!attach_sounding_identity(record)) {
            s_marker_misses++;
        }
    }
    record->header.dropped_total = s_queue_drops;
    if (s_queue_drops > 0) {
        record->header.status_flags |= CSI_STATUS_QUEUE_DROPS_PRESENT;
    }

    const uart_port_t port = (uart_port_t)CONFIG_SCANIT_CSI_UART_PORT;
    const int header_written = uart_write_bytes(
        port,
        (const char *)&record->header,
        sizeof(record->header)
    );
    const int payload_written = uart_write_bytes(
        port,
        (const char *)record->payload,
        record->header.payload_bytes
    );
    if (header_written != (int)sizeof(record->header) ||
        payload_written != (int)record->header.payload_bytes) {
        s_queue_drops++;
        return;
    }

    s_records_written++;
    if ((s_records_written % 200u) == 0u) {
        ESP_LOGI(
            TAG,
            "written=%" PRIu32 " queue_drops=%" PRIu32 " marker_misses=%" PRIu32,
            s_records_written,
            s_queue_drops,
            s_marker_misses
        );
    }
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

static esp_err_t initialise_binary_uart(void)
{
    const uart_port_t port = (uart_port_t)CONFIG_SCANIT_CSI_UART_PORT;
    const uart_config_t configuration = {
        .baud_rate = CONFIG_SCANIT_CSI_UART_BAUD,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    ESP_RETURN_ON_ERROR(uart_driver_install(port, 4096, 0, 0, NULL, 0), TAG, "UART driver");
    ESP_RETURN_ON_ERROR(uart_param_config(port, &configuration), TAG, "UART config");
    ESP_RETURN_ON_ERROR(
        uart_set_pin(
            port,
            CONFIG_SCANIT_CSI_UART_TX_GPIO,
            CONFIG_SCANIT_CSI_UART_RX_GPIO,
            UART_PIN_NO_CHANGE,
            UART_PIN_NO_CHANGE
        ),
        TAG,
        "UART pins"
    );
    return ESP_OK;
}

static esp_err_t configure_csi(void)
{
#if CONFIG_SOC_WIFI_HE_SUPPORT
    wifi_csi_config_t configuration = {
        .enable = true,
        .acquire_csi_legacy = true,
        .acquire_csi_ht20 = true,
        .acquire_csi_ht40 = false,
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
    ESP_RETURN_ON_ERROR(esp_wifi_set_mode(WIFI_MODE_STA), TAG, "wifi mode");
    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "wifi start");
    ESP_RETURN_ON_ERROR(esp_wifi_set_country_code("SE", true), TAG, "country code");
    ESP_RETURN_ON_ERROR(esp_wifi_set_bandwidth(WIFI_IF_STA, WIFI_BW_HT20), TAG, "HT20 bandwidth");
    ESP_RETURN_ON_ERROR(
        esp_wifi_set_channel(CONFIG_SCANIT_CSI_CHANNEL, WIFI_SECOND_CHAN_NONE),
        TAG,
        "CSI channel"
    );

    wifi_promiscuous_filter_t filter = {
        .filter_mask = WIFI_PROMIS_FILTER_MASK_DATA,
    };
    ESP_RETURN_ON_ERROR(esp_wifi_set_promiscuous_filter(&filter), TAG, "promiscuous filter");
    ESP_RETURN_ON_ERROR(
        esp_wifi_set_promiscuous_rx_cb(promiscuous_rx_callback),
        TAG,
        "promiscuous callback"
    );
    ESP_RETURN_ON_ERROR(esp_wifi_set_promiscuous(true), TAG, "promiscuous mode");
    return configure_csi();
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

    ESP_ERROR_CHECK(initialise_binary_uart());
    s_csi_queue = xQueueCreate(CSI_QUEUE_DEPTH, sizeof(queued_csi_record_t));
    if (s_csi_queue == NULL) {
        ESP_LOGE(TAG, "unable to allocate CSI queue");
        abort();
    }
    xTaskCreate(csi_writer_task, "csi-writer", 6144, NULL, 5, NULL);
    ESP_ERROR_CHECK(initialise_wifi_for_csi());
    ESP_LOGI(
        TAG,
        "CSI0 v2 receiver active on channel %d; binary output UART%d at %d baud",
        CONFIG_SCANIT_CSI_CHANNEL,
        CONFIG_SCANIT_CSI_UART_PORT,
        CONFIG_SCANIT_CSI_UART_BAUD
    );
}
