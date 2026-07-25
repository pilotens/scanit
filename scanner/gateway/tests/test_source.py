from __future__ import annotations

import unittest

from scanit_gateway.config import FmcwConfig
from scanit_gateway.protocol import decode_frame, encode_frame
from scanit_gateway.source import FakeRadarSource


class FakeSourceTests(unittest.TestCase):
    def test_emits_scanner_compatible_raw_cube(self) -> None:
        source = FakeRadarSource()
        source.connect()
        source.configure(FmcwConfig(samples_per_chirp=64, chirps_per_frame=8, frame_rate_hz=100))
        frame = source.read_frame(session_id="test", position="apex", sequence=0)
        self.assertEqual(frame["channels"], 3)
        self.assertEqual(frame["samplesPerChannel"], 8 * 64)
        self.assertEqual(len(frame["samples"]), 3 * 8 * 64 * 2)
        self.assertEqual(frame["dataLayout"], "rx-chirp-sample")
        self.assertEqual(frame["sampleFormat"], "real-adc-in-iq-container")
        self.assertEqual(frame["acquisition"]["rawCubeShape"], [3, 8, 64])
        self.assertEqual(frame["acquisition"]["chirpReduction"], "none")
        decoded = decode_frame(encode_frame(frame))
        self.assertEqual(decoded["position"], "apex")
        self.assertEqual(decoded["acquisition"]["rawCubeShape"], [3, 8, 64])


if __name__ == "__main__":
    unittest.main()
