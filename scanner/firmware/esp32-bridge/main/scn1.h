#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define SCN1_MAX_PACKET_BYTES (1024 * 1024)

bool scn1_validate_packet(const uint8_t *packet, size_t length);
