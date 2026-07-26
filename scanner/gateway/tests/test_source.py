from __future__ import annotations

import unittest

from scanit_gateway.config import FmcwConfig
from scanit_gateway.protocol import decode_frame, encode_frame
from scanit_gateway.source import FakeRadarSource


class FakeSourceTests(unittest.TestCase):
    def test_emits_scanner_compatible_raw_cube_with_monotonic_timing(self) -> None:
        source = FakeRadarSource()
        source.connect()
        source.configure(
            FmcwConfig(
                samples_per_chirp=64,
                chirps_per_frame=8,
                frame_rate_hz=100,
            )
        )
        first = source.read_frame(session_id="test", position="apex", sequence=0)
        second = source.read_frame(session_id="test", position="apex", sequence=1)

        self.assertEqual(first["channels"], 3)
        self.assertEqual(first["samplesPerChannel"], 8 * 64)
        self.assertEqual(len(first["samples"]), 3 * 8 * 64 * 2)
        self.assertEqual(first["dataLayout"], "rx-chirp-sample")
        self.assertEqual(first["sampleFormat"], "real-adc-in-iq-container")
        self.assertEqual(first["acquisition"]["rawCubeShape"], [3, 8, 64])
        self.assertEqual(first["acquisition"]["chirpReduction"], "none")
        self.assertEqual(
            first["timestampNs"],
            first["timing"]["monotonicTimestampNs"],
        )
        self.assertEqual(
            first["timing"]["clockDomain"],
            second["timing"]["clockDomain"],
        )
        self.assertGreater(int(second["timestampNs"]), int(first["timestampNs"]))
        self.assertGreater(first["timing"]["uncertaintyNs"], 0)
        self.assertIn("wallClockUnixNs", first["timing"])

        decoded = decode_frame(encode_frame(first))
        self.assertEqual(decoded["position"], "apex")
        self.assertEqual(decoded["acquisition"]["rawCubeShape"], [3, 8, 64])
        self.assertEqual(decoded["timing"]["clockDomain"], first["timing"]["clockDomain"])


if __name__ == "__main__":
    unittest.main()
