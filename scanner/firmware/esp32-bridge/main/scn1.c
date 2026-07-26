#include "scn1.h"

#include <string.h>

static uint16_t read_u16_le(const uint8_t *data) {
    return (uint16_t)data[0] | ((uint16_t)data[1] << 8);
}

static uint32_t read_u32_le(const uint8_t *data) {
    return (uint32_t)data[0] |
           ((uint32_t)data[1] << 8) |
           ((uint32_t)data[2] << 16) |
           ((uint32_t)data[3] << 24);
}

static uint32_t crc32(const uint8_t *data, size_t length) {
    uint32_t crc = 0xFFFFFFFFu;
    for (size_t index = 0; index < length; ++index) {
        crc ^= data[index];
        for (int bit = 0; bit < 8; ++bit) {
            uint32_t mask = -(crc & 1u);
            crc = (crc >> 1) ^ (0xEDB88320u & mask);
        }
    }
    return ~crc;
}

bool scn1_validate_packet(const uint8_t *packet, size_t length) {
    if (packet == NULL || length < 16 || length > SCN1_MAX_PACKET_BYTES) return false;
    if (memcmp(packet, "SCN1", 4) != 0) return false;
    if (read_u16_le(packet + 4) != 1) return false;

    const uint16_t header_length = read_u16_le(packet + 6);
    const uint32_t payload_length = read_u32_le(packet + 8);
    const size_t checksum_offset = 12u + header_length + payload_length;
    if (checksum_offset + 4u != length) return false;

    const uint32_t expected = read_u32_le(packet + checksum_offset);
    return crc32(packet, checksum_offset) == expected;
}
