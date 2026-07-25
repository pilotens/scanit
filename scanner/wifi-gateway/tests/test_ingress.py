from __future__ import annotations

import unittest

from scanit_wifi_gateway.ingress import (
    CSI0_HEADER,
    CSI0_MAGIC,
    CSI0_VERSION,
    Csi0StreamParser,
    CsiIngressError,
    WifiFrameMapping,
    record_to_wcs1_frame,
)


def record_bytes(payload: bytes, *, first_word_invalid: bool = False) -> bytes:
    header = CSI0_HEADER.pack(
        CSI0_MAGIC,
        CSI0_VERSION,
        CSI0_HEADER.size,
        17,
        12_345_678,
        bytes.fromhex("001122334455"),
        -48,
        -95,
        36,
        0,
        1,
        3,
        0,
        1 if first_word_invalid else 0,
        len(payload),
    )
    return header + payload


class CsiIngressTests(unittest.TestCase):
    def test_stream_parser_handles_split_records(self) -> None:
        payload = bytes([1, 10, 2, 20, 3, 30, 4, 40])
        packet = record_bytes(payload)
        parser = Csi0StreamParser()

        first = parser.feed(packet[:11])
        second = parser.feed(packet[11:])

        self.assertEqual(first, [])
        self.assertEqual(len(second), 1)
        self.assertEqual(second[0].sequence, 17)
        self.assertEqual(second[0].source_mac, "00:11:22:33:44:55")
        self.assertEqual(second[0].payload, payload)

    def test_maps_int8_imaginary_real_pairs_to_wcs1(self) -> None:
        payload = bytes([1, 10, 254, 20, 3, 226, 252, 40])
        record = Csi0StreamParser().feed(record_bytes(payload))[0]
        mapping = WifiFrameMapping(
            session_id="test",
            tx_node_id="tx",
            rx_node_id="rx-left",
            clock_domain="node-clock",
            band="5-ghz",
            center_frequency_hz=5_180_000_000,
            bandwidth_hz=20_000_000,
            phy="he",
            spatial_stream=0,
            subcarrier_indices=(-2, -1, 1, 2),
        )

        frame = record_to_wcs1_frame(record, mapping)

        self.assertEqual(frame["csi"], [10.0, 1.0, 20.0, -2.0, -30.0, 3.0, 40.0, -4.0])
        self.assertEqual(frame["soundingSequence"], 17)
        self.assertEqual(frame["timing"]["clockDomain"], "node-clock")
        self.assertFalse(frame["isSimulated"])

    def test_rejects_unknown_subcarrier_dimensions(self) -> None:
        payload = bytes([1, 10, 2, 20])
        record = Csi0StreamParser().feed(record_bytes(payload))[0]
        mapping = WifiFrameMapping(
            session_id="test",
            tx_node_id="tx",
            rx_node_id="rx",
            clock_domain="clock",
            band="5-ghz",
            center_frequency_hz=5_180_000_000,
            bandwidth_hz=20_000_000,
            phy="he",
            spatial_stream=0,
            subcarrier_indices=(-2, -1, 1),
        )

        with self.assertRaisesRegex(CsiIngressError, "cannot be mapped safely"):
            record_to_wcs1_frame(record, mapping)


if __name__ == "__main__":
    unittest.main()
