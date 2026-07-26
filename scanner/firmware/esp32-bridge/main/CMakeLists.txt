idf_component_register(
  SRCS "app_main.c" "scn1.c"
  INCLUDE_DIRS "."
  REQUIRES bt driver esp_event esp_http_server esp_netif esp_wifi nvs_flash
)
