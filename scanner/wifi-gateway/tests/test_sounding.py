from __future__ import annotations

import unittest

from scanit_wifi_gateway.sounding import (
    SND1_PACKET,
    SoundingIdentity,
    SoundingProtocolError,
    decode_sounding_payload,
    encode_sounding_payload,
    parse_sounding_data_frame,
)


class SoundingProtocolTests(unittest.TestCase):
    def test_round_trips_sounding_identity_and_crc(self) -> None:
        identity = SoundingIdentity(
            session_nonce=0x5343414E,
            sounding_id=42,
            tx_monotonic_us=12_345_678,
            channel=36,
            sounding_rate_hz=20,
        )
        payload = encode_sounding_payload(identity)

        self.assertEqual(len(payload), SND1_PACKET.size)
        self.assertEqual(decode_sounding_payload(payload), identity)

    def test_parses_non_qos_data_frame_payload(self) -> None:
        identity = SoundingIdentity(
            session_nonce=7,
            sounding_id=0xABCDE,
            tx_monotonic_us=999,
            channel=36,
            sounding_rate_hz=50,
        )
        header = bytearray(24)
        header[0:2] = (0x0008).to_bytes(2, "little")
        frame = bytes(header) + encode_sounding_payload(identity)

        self.assertEqual(parse_sounding_data_frame(frame), identity)

    def test_rejects_corruption(self) -> None:
        payload = bytearray(
            encode_sounding_payload(
                SoundingIdentity(
                    session_nonce=1,
                    sounding_id=2,
                    tx_monotonic_us=3,
                    channel=36,
                    sounding_rate_hz=20,
                )
            )
        )
        payload[17] ^= 0x80

        with self.assertRaisesRegex(SoundingProtocolError, "CRC"):
            decode_sounding_payload(bytes(payload))


if __name__ == "__main__":
    unittest.main()
