from __future__ import annotations

import unittest

from scanit_wifi_gateway.protocol import WifiProtocolError, decode_frame, encode_frame
from scanit_wifi_gateway.source import FakeWifiCsiSource, WifiGatewayConfig


class WifiProtocolTests(unittest.TestCase):
    def test_round_trip_preserves_csi_and_metadata(self) -> None:
        source = FakeWifiCsiSource()
        source.connect()
        source.configure(WifiGatewayConfig(frame_rate_hz=100))
        frame = source.read_frame()

        decoded = decode_frame(encode_frame(frame))

        self.assertEqual(decoded["sessionId"], frame["sessionId"])
        self.assertEqual(decoded["rxNodeId"], frame["rxNodeId"])
        self.assertEqual(decoded["subcarrierIndices"], frame["subcarrierIndices"])
        self.assertEqual(len(decoded["csi"]), len(frame["csi"]))
        self.assertAlmostEqual(decoded["csi"][5], frame["csi"][5], places=5)

    def test_rejects_crc_corruption(self) -> None:
        source = FakeWifiCsiSource()
        frame = source.read_frame()
        packet = bytearray(encode_frame(frame))
        packet[len(packet) // 2] ^= 0xFF

        with self.assertRaisesRegex(WifiProtocolError, "CRC"):
            decode_frame(bytes(packet))

    def test_rejects_dimension_mismatch(self) -> None:
        source = FakeWifiCsiSource()
        frame = source.read_frame()
        frame["csi"] = frame["csi"][:-2]

        with self.assertRaisesRegex(WifiProtocolError, "dimensions"):
            encode_frame(frame)


if __name__ == "__main__":
    unittest.main()
