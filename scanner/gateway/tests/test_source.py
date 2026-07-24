from __future__ import annotations

import unittest

from scanit_gateway.config import FmcwConfig
from scanit_gateway.protocol import decode_frame, encode_frame
from scanit_gateway.source import FakeRadarSource


class FakeSourceTests(unittest.TestCase):
    def test_emits_scanner_compatible_frame(self) -> None:
        source = FakeRadarSource()
        source.connect()
        source.configure(FmcwConfig(samples_per_chirp=64, chirps_per_frame=8, frame_rate_hz=100))
        frame = source.read_frame(session_id="test", position="apex", sequence=0)
        self.assertEqual(frame["channels"], 3)
        self.assertEqual(frame["samplesPerChannel"], 64)
        self.assertEqual(len(frame["samples"]), 3 * 64 * 2)
        decoded = decode_frame(encode_frame(frame))
        self.assertEqual(decoded["position"], "apex")


if __name__ == "__main__":
    unittest.main()
