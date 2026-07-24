from __future__ import annotations

import unittest

from scanit_gateway.protocol import ProtocolError, decode_frame, encode_frame


class ProtocolTests(unittest.TestCase):
    def frame(self) -> dict:
        return {
            "frameId": "fixture-1",
            "sessionId": "session-1",
            "sequence": 7,
            "timestampNs": "123456789",
            "modality": "mmwave-fmcw",
            "position": "apex",
            "centerFrequencyHz": 60_500_000_000,
            "bandwidthHz": 5_000_000_000,
            "sampleRateHz": 2_000_000,
            "channels": 2,
            "samplesPerChannel": 2,
            "samples": [0.25, 0.0, -0.5, 0.0, 0.75, 0.0, 1.0, 0.0],
            "antennaConfigurationId": "fixture",
            "qualityFlags": [],
            "isSimulated": False,
        }

    def test_round_trip(self) -> None:
        decoded = decode_frame(encode_frame(self.frame()))
        self.assertEqual(decoded["frameId"], "fixture-1")
        self.assertEqual(decoded["sequence"], 7)
        self.assertEqual(len(decoded["samples"]), 8)
        self.assertAlmostEqual(decoded["samples"][2], -0.5)

    def test_crc_detects_corruption(self) -> None:
        packet = bytearray(encode_frame(self.frame()))
        packet[-5] ^= 0x7F
        with self.assertRaisesRegex(ProtocolError, "CRC"):
            decode_frame(bytes(packet))

    def test_rejects_dimension_mismatch(self) -> None:
        frame = self.frame()
        frame["samples"] = [0.0]
        with self.assertRaisesRegex(ProtocolError, "sample length"):
            encode_frame(frame)


if __name__ == "__main__":
    unittest.main()
