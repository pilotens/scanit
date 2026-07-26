from __future__ import annotations

import unittest

from scanit_wifi_gateway.aggregate import MultiLinkWifiCsiSource
from scanit_wifi_gateway.digital_bench import (
    DigitalBenchCsi0Source,
    DigitalBenchFaultProfile,
    DigitalBenchScenario,
    digital_bench_scenario,
)
from scanit_wifi_gateway.source import WifiGatewayConfig


SUBCARRIERS = tuple(list(range(-28, 0)) + list(range(1, 29)))


def config(session_id: str = "digital-bench-test") -> WifiGatewayConfig:
    return WifiGatewayConfig(
        session_id=session_id,
        tx_node_id="tx-bench",
        rx_node_id="rx-1",
        clock_domain="bench-clock",
        band="5-ghz",
        channel=36,
        center_frequency_hz=5_180_000_000,
        bandwidth_hz=20_000_000,
        phy="ht",
        frame_rate_hz=20,
        subcarrier_indices=SUBCARRIERS,
    )


class DigitalBenchSourceTests(unittest.TestCase):
    def test_uses_real_csi0_v2_parser_before_wcs1(self) -> None:
        source = DigitalBenchCsi0Source(0, digital_bench_scenario("healthy", 1))
        try:
            source.connect()
            source.configure(config())
            frame = source.read_frame()
            status = source.status()
        finally:
            source.close()

        self.assertEqual(frame["csi0Version"], 2)
        self.assertEqual(frame["soundingIdSource"], "transmitter-payload")
        self.assertEqual(frame["soundingSequence"], 0)
        self.assertEqual(frame["phy"], "ht")
        self.assertEqual(len(frame["csi"]), len(SUBCARRIERS) * 2)
        self.assertIn("receiver-antenna-index-unknown", frame["qualityFlags"])
        self.assertEqual(status["csi0V2RecordsDecoded"], 1)
        self.assertGreater(status["benchFragments"], 5)
        self.assertGreater(status["benchWireBytes"], len(frame["csi"]))

    def test_clock_drift_is_preserved_in_receiver_timing(self) -> None:
        scenario = DigitalBenchScenario(
            name="clock-test",
            receiver_faults={0: DigitalBenchFaultProfile(clock_drift_ppm=250)},
        )
        source = DigitalBenchCsi0Source(0, scenario)
        try:
            source.connect()
            source.configure(config())
            first = source.read_frame()
            second = source.read_frame()
        finally:
            source.close()

        receiver_delta = int(second["receiverOriginalTiming"]["monotonicTimestampNs"]) - int(
            first["receiverOriginalTiming"]["monotonicTimestampNs"]
        ) if "receiverOriginalTiming" in second else int(second["timestampNs"]) - int(first["timestampNs"])
        transmitter_delta = int(second["transmitterTimestampNs"]) - int(first["transmitterTimestampNs"])
        self.assertGreater(receiver_delta, transmitter_delta)

    def test_truncated_payload_fails_before_wcs1(self) -> None:
        scenario = DigitalBenchScenario(
            name="truncate-test",
            receiver_faults={0: DigitalBenchFaultProfile(truncated_soundings=frozenset({0}))},
        )
        source = DigitalBenchCsi0Source(0, scenario)
        try:
            source.connect()
            source.configure(config())
            with self.assertRaisesRegex(ValueError, "cannot be mapped safely"):
                source.read_frame()
        finally:
            source.close()


class DigitalBenchMultiLinkTests(unittest.TestCase):
    def test_aligns_independently_started_receivers_by_transmitter_id(self) -> None:
        scenario = digital_bench_scenario("start-offsets", 3)
        source = MultiLinkWifiCsiSource(
            [
                ("rx-left", DigitalBenchCsi0Source(0, scenario)),
                ("rx-right", DigitalBenchCsi0Source(1, scenario)),
                ("rx-reference", DigitalBenchCsi0Source(2, scenario)),
            ]
        )
        try:
            source.connect()
            source.configure(config("offset-test"))
            frames = [source.read_frame() for _ in range(6)]
            status = source.status()
        finally:
            source.close()

        first = frames[:3]
        second = frames[3:]
        self.assertEqual({frame["soundingSequence"] for frame in first}, {6})
        self.assertEqual({frame["soundingSequence"] for frame in second}, {7})
        self.assertEqual(
            {frame["rxNodeId"] for frame in first},
            {"rx-left", "rx-right", "rx-reference"},
        )
        self.assertGreaterEqual(status["discardedUnpairedFrames"], 0)
        self.assertEqual(status["fallbackSoundingBatches"], 0)
        self.assertEqual(status["activeSoundingSessionNonce"], scenario.session_nonce)

    def test_skipped_receiver_packet_does_not_create_false_pair(self) -> None:
        scenario = DigitalBenchScenario(
            name="single-loss",
            receiver_faults={
                0: DigitalBenchFaultProfile(),
                1: DigitalBenchFaultProfile(dropped_soundings=frozenset({2})),
            },
        )
        source = MultiLinkWifiCsiSource(
            [
                ("rx-a", DigitalBenchCsi0Source(0, scenario)),
                ("rx-b", DigitalBenchCsi0Source(1, scenario)),
            ]
        )
        try:
            source.connect()
            source.configure(config("loss-test"))
            frames = [source.read_frame() for _ in range(8)]
            status = source.status()
        finally:
            source.close()

        soundings = [frames[index]["soundingSequence"] for index in range(0, len(frames), 2)]
        self.assertEqual(soundings, [0, 1, 3, 4])
        self.assertGreaterEqual(status["transmitterSoundingGaps"], 1)
        self.assertTrue(
            any("transmitter-sounding-gap-observed" in frame["qualityFlags"] for frame in frames)
        )

    def test_rejects_mixed_explicit_and_fallback_identity(self) -> None:
        scenario = DigitalBenchScenario(
            name="identity-failure",
            receiver_faults={
                0: DigitalBenchFaultProfile(missing_identity_soundings=frozenset({0})),
                1: DigitalBenchFaultProfile(),
            },
        )
        source = MultiLinkWifiCsiSource(
            [
                ("rx-a", DigitalBenchCsi0Source(0, scenario)),
                ("rx-b", DigitalBenchCsi0Source(1, scenario)),
            ]
        )
        try:
            source.connect()
            source.configure(config("identity-test"))
            with self.assertRaisesRegex(RuntimeError, "Some receiver nodes expose"):
                source.read_frame()
        finally:
            source.close()

    def test_nonce_change_is_blocked_during_active_capture(self) -> None:
        scenario = DigitalBenchScenario(
            name="nonce-failure",
            receiver_faults={
                0: DigitalBenchFaultProfile(nonce_change_at=2),
                1: DigitalBenchFaultProfile(nonce_change_at=2),
            },
        )
        source = MultiLinkWifiCsiSource(
            [
                ("rx-a", DigitalBenchCsi0Source(0, scenario)),
                ("rx-b", DigitalBenchCsi0Source(1, scenario)),
            ]
        )
        try:
            source.connect()
            source.configure(config("nonce-test"))
            _ = [source.read_frame() for _ in range(4)]
            with self.assertRaisesRegex(RuntimeError, "session nonce changed"):
                source.read_frame()
        finally:
            source.close()


if __name__ == "__main__":
    unittest.main()
