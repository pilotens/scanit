#include <stdlib.h>
#include <string.h>

#include "driver/uart.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "host/ble_hs.h"
#include "host/ble_uuid.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "nvs_flash.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

#include "scn1.h"

#define SCANIT_UART UART_NUM_1
#define SCANIT_WS_PATH "/stream"
#define SCANIT_ENDPOINT "ws://192.168.4.1/stream"

static const char *TAG = "scanit-bridge";
static httpd_handle_t http_server;
static int websocket_fd = -1;
static volatile bool stream_enabled = false;
static uint16_t status_value_handle;

static const ble_uuid128_t service_uuid = BLE_UUID128_INIT(
    0x5f, 0x3a, 0x01, 0x00, 0x89, 0x77, 0x4a, 0x7b,
    0x90, 0xc4, 0x9a, 0x44, 0x10, 0x00, 0x51, 0xa1);
static const ble_uuid128_t control_uuid = BLE_UUID128_INIT(
    0x5f, 0x3a, 0x01, 0x01, 0x89, 0x77, 0x4a, 0x7b,
    0x90, 0xc4, 0x9a, 0x44, 0x10, 0x00, 0x51, 0xa1);
static const ble_uuid128_t endpoint_uuid = BLE_UUID128_INIT(
    0x5f, 0x3a, 0x01, 0x02, 0x89, 0x77, 0x4a, 0x7b,
    0x90, 0xc4, 0x9a, 0x44, 0x10, 0x00, 0x51, 0xa1);
static const ble_uuid128_t status_uuid = BLE_UUID128_INIT(
    0x5f, 0x3a, 0x01, 0x03, 0x89, 0x77, 0x4a, 0x7b,
    0x90, 0xc4, 0x9a, 0x44, 0x10, 0x00, 0x51, 0xa1);

static void notify_status(void) {
    const char *status = stream_enabled ? "streaming" : "idle";
    struct os_mbuf *om = ble_hs_mbuf_from_flat(status, strlen(status));
    if (om != NULL) ble_gatts_notify_custom(BLE_HS_CONN_HANDLE_NONE, status_value_handle, om);
}

static int gatt_access(
    uint16_t connection_handle,
    uint16_t attribute_handle,
    struct ble_gatt_access_ctxt *context,
    void *argument) {
    (void)connection_handle;
    (void)attribute_handle;
    const char *kind = argument;

    if (strcmp(kind, "endpoint") == 0 && context->op == BLE_GATT_ACCESS_OP_READ_CHR) {
        return os_mbuf_append(context->om, SCANIT_ENDPOINT, strlen(SCANIT_ENDPOINT)) == 0
            ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    if (strcmp(kind, "status") == 0 && context->op == BLE_GATT_ACCESS_OP_READ_CHR) {
        const char *status = stream_enabled ? "streaming" : "idle";
        return os_mbuf_append(context->om, status, strlen(status)) == 0
            ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    if (strcmp(kind, "control") == 0 && context->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
        char command[32] = {0};
        const uint16_t length = OS_MBUF_PKTLEN(context->om);
        if (length == 0 || length >= sizeof(command)) return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        ble_hs_mbuf_to_flat(context->om, command, length, NULL);
        if (strncmp(command, "START", 5) == 0) stream_enabled = true;
        else if (strncmp(command, "STOP", 4) == 0) stream_enabled = false;
        else return BLE_ATT_ERR_VALUE_NOT_ALLOWED;
        notify_status();
        return 0;
    }
    return BLE_ATT_ERR_UNLIKELY;
}

static const struct ble_gatt_svc_def gatt_services[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &service_uuid.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            {
                .uuid = &control_uuid.u,
                .access_cb = gatt_access,
                .arg = "control",
                .flags = BLE_GATT_CHR_F_WRITE,
            },
            {
                .uuid = &endpoint_uuid.u,
                .access_cb = gatt_access,
                .arg = "endpoint",
                .flags = BLE_GATT_CHR_F_READ,
            },
            {
                .uuid = &status_uuid.u,
                .access_cb = gatt_access,
                .arg = "status",
                .val_handle = &status_value_handle,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY,
            },
            {0},
        },
    },
    {0},
};

static int gap_event(struct ble_gap_event *event, void *argument);

static void advertise(void) {
    struct ble_hs_adv_fields fields = {0};
    const char *name = ble_svc_gap_device_name();
    fields.name = (const uint8_t *)name;
    fields.name_len = strlen(name);
    fields.name_is_complete = 1;
    fields.uuids128 = (ble_uuid128_t *)&service_uuid;
    fields.num_uuids128 = 1;
    fields.uuids128_is_complete = 1;
    ble_gap_adv_set_fields(&fields);

    uint8_t own_address_type;
    ble_hs_id_infer_auto(0, &own_address_type);
    struct ble_gap_adv_params parameters = {0};
    parameters.conn_mode = BLE_GAP_CONN_MODE_UND;
    parameters.disc_mode = BLE_GAP_DISC_MODE_GEN;
    ble_gap_adv_start(own_address_type, NULL, BLE_HS_FOREVER, &parameters, gap_event, NULL);
}

static int gap_event(struct ble_gap_event *event, void *argument) {
    (void)argument;
    if (event->type == BLE_GAP_EVENT_DISCONNECT || event->type == BLE_GAP_EVENT_ADV_COMPLETE) {
        advertise();
    }
    return 0;
}

static void ble_sync(void) { advertise(); }
static void ble_host_task(void *parameter) {
    (void)parameter;
    nimble_port_run();
    nimble_port_freertos_deinit();
}

static void start_ble(void) {
    nimble_port_init();
    ble_svc_gap_init();
    ble_svc_gatt_init();
    ble_svc_gap_device_name_set("ScanIt Scanner");
    ble_gatts_count_cfg(gatt_services);
    ble_gatts_add_svcs(gatt_services);
    ble_hs_cfg.sync_cb = ble_sync;
    nimble_port_freertos_init(ble_host_task);
}

static esp_err_t websocket_handler(httpd_req_t *request) {
    if (request->method == HTTP_GET) {
        websocket_fd = httpd_req_to_sockfd(request);
        ESP_LOGI(TAG, "WebSocket client connected: fd=%d", websocket_fd);
        return ESP_OK;
    }

    httpd_ws_frame_t frame = {0};
    esp_err_t result = httpd_ws_recv_frame(request, &frame, 0);
    if (result != ESP_OK) return result;
    uint8_t *payload = calloc(1, frame.len + 1);
    if (payload == NULL) return ESP_ERR_NO_MEM;
    frame.payload = payload;
    result = httpd_ws_recv_frame(request, &frame, frame.len);
    if (result == ESP_OK && frame.type == HTTPD_WS_TYPE_TEXT) {
        if (frame.len >= 5 && memcmp(payload, "START", 5) == 0) stream_enabled = true;
        else if (frame.len >= 4 && memcmp(payload, "STOP", 4) == 0) stream_enabled = false;
        notify_status();
    }
    free(payload);
    return result;
}

static void start_http_server(void) {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_open_sockets = 2;
    ESP_ERROR_CHECK(httpd_start(&http_server, &config));
    httpd_uri_t stream = {
        .uri = SCANIT_WS_PATH,
        .method = HTTP_GET,
        .handler = websocket_handler,
        .is_websocket = true,
    };
    ESP_ERROR_CHECK(httpd_register_uri_handler(http_server, &stream));
}

static void start_wifi_access_point(void) {
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_ap();
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    wifi_config_t config = {0};
    strncpy((char *)config.ap.ssid, CONFIG_SCANIT_WIFI_SSID, sizeof(config.ap.ssid));
    strncpy((char *)config.ap.password, CONFIG_SCANIT_WIFI_PASSWORD, sizeof(config.ap.password));
    config.ap.ssid_len = strlen(CONFIG_SCANIT_WIFI_SSID);
    config.ap.channel = 6;
    config.ap.max_connection = 2;
    config.ap.authmode = strlen(CONFIG_SCANIT_WIFI_PASSWORD) >= 8
        ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &config));
    ESP_ERROR_CHECK(esp_wifi_start());
}

static bool uart_read_exact(uint8_t *buffer, size_t length) {
    size_t offset = 0;
    while (offset < length) {
        int received = uart_read_bytes(
            SCANIT_UART,
            buffer + offset,
            length - offset,
            pdMS_TO_TICKS(1000));
        if (received <= 0) return false;
        offset += received;
    }
    return true;
}

static uint32_t read_length_le(const uint8_t prefix[4]) {
    return (uint32_t)prefix[0] |
           ((uint32_t)prefix[1] << 8) |
           ((uint32_t)prefix[2] << 16) |
           ((uint32_t)prefix[3] << 24);
}

static void uart_ingress_task(void *parameter) {
    (void)parameter;
    uint8_t prefix[4];
    while (true) {
        if (!uart_read_exact(prefix, sizeof(prefix))) continue;
        const uint32_t length = read_length_le(prefix);
        if (length < 16 || length > SCN1_MAX_PACKET_BYTES) {
            ESP_LOGW(TAG, "Rejected UART packet length: %lu", (unsigned long)length);
            uart_flush_input(SCANIT_UART);
            continue;
        }
        uint8_t *packet = malloc(length);
        if (packet == NULL) continue;
        const bool read_ok = uart_read_exact(packet, length);
        if (read_ok && scn1_validate_packet(packet, length) &&
            stream_enabled && websocket_fd >= 0 && http_server != NULL) {
            httpd_ws_frame_t frame = {
                .final = true,
                .fragmented = false,
                .type = HTTPD_WS_TYPE_BINARY,
                .payload = packet,
                .len = length,
            };
            esp_err_t result = httpd_ws_send_frame_async(http_server, websocket_fd, &frame);
            if (result != ESP_OK) websocket_fd = -1;
        }
        free(packet);
    }
}

static void start_uart(void) {
    uart_config_t config = {
        .baud_rate = CONFIG_SCANIT_UART_BAUD,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    ESP_ERROR_CHECK(uart_driver_install(SCANIT_UART, 8192, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(SCANIT_UART, &config));
    ESP_ERROR_CHECK(uart_set_pin(
        SCANIT_UART,
        CONFIG_SCANIT_UART_TX_PIN,
        CONFIG_SCANIT_UART_RX_PIN,
        UART_PIN_NO_CHANGE,
        UART_PIN_NO_CHANGE));
    xTaskCreate(uart_ingress_task, "scn1-uart", 6144, NULL, 8, NULL);
}

void app_main(void) {
    esp_err_t nvs = nvs_flash_init();
    if (nvs == ESP_ERR_NVS_NO_FREE_PAGES || nvs == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }
    start_wifi_access_point();
    start_http_server();
    start_uart();
    start_ble();
    ESP_LOGI(TAG, "ScanIt bridge ready at %s", SCANIT_ENDPOINT);
}
