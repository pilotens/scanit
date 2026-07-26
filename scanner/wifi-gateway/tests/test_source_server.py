from __future__ import annotations

import asyncio
import json
import unittest

from scanit_wifi_gateway.aggregate import MultiLinkWifiCsiSource
from scanit_wifi_gateway.protocol import decode_frame
from scanit_wifi_gateway.server import WifiCsiGatewayServer
from scanit_wifi_gateway.source import FakeWifiCsiSource, WifiGatewayConfig


class MultiLinkSourceTests(unittest.TestCase):
    def test_matches_receivers_by_transmitter_sounding_id(self) -> None:
        left = FakeWifiCsiSource()
        right = FakeWifiCsiSource()
        reference = FakeWifiCsiSource()
        source = MultiLinkWifiCsiSource(
            [
                ("rx-left", left),
                ("rx-right", right),
                ("rx-reference", reference),
            ]
        )
        try:
            source.connect()
            source.configure(
                WifiGatewayConfig(
                    session_id="multi-test",
                    frame_rate_hz=100,
                    require_explicit_sounding_id=True,
                )
            )
            # Configure intentionally resets a new capture session. Apply the
            # simulated receiver start offsets afterwards so the test exercises
            # exact SND1 intersection rather than stale session state.
            left._sequence = 0  # type: ignore[attr-defined]
            right._sequence = 3  # type: ignore[attr-defined]
            reference._sequence = 1  # type: ignore[attr-defined]
            frames = [source.read_frame() for _ in range(6)]
            status = source.status()
        finally:
            source.close()

        first_sounding = frames[:3]
        second_sounding = frames[3:]
        self.assertEqual({frame["soundingSequence"] for frame in first_sounding}, {3})
        self.assertEqual({frame["soundingSequence"] for frame in second_sounding}, {4})
        self.assertEqual(
            {frame["rxNodeId"] for frame in first_sounding},
            {"rx-left", "rx-right", "rx-reference"},
        )
        self.assertEqual(
            {frame["soundingSessionNonce"] for frame in first_sounding},
            {0x5343414E},
        )
        self.assertTrue(
            all(frame["soundingIdSource"] == "transmitter-payload" for frame in frames)
        )
        self.assertTrue(
            all(
                "explicit-transmitter-sounding-id" in frame["qualityFlags"]
                for frame in frames
            )
        )
        self.assertEqual(len({frame["sequence"] for frame in frames}), 6)
        self.assertEqual(len({frame["timing"]["clockDomain"] for frame in frames}), 1)
        self.assertEqual(status["explicitSoundingBatches"], 2)
        self.assertEqual(status["fallbackSoundingBatches"], 0)
        self.assertGreater(status["discardedUnpairedFrames"], 0)

    def test_rejects_fallback_sequences_when_explicit_ids_are_required(self) -> None:
        class FallbackFake(FakeWifiCsiSource):
            def read_frame(self):  # type: ignore[no-untyped-def]
                frame = super().read_frame()
                frame.pop("soundingSessionNonce", None)
                frame["soundingIdSource"] = "receiver-sequence-fallback"
                return frame

            def status(self):  # type: ignore[no-untyped-def]
                return {**super().status(), "supportsExplicitSoundingId": False}

        source = MultiLinkWifiCsiSource(
            [("rx-a", FallbackFake()), ("rx-b", FallbackFake())]
        )
        try:
            source.connect()
            source.configure(
                WifiGatewayConfig(
                    session_id="strict-test",
                    frame_rate_hz=100,
                    require_explicit_sounding_id=True,
                )
            )
            with self.assertRaisesRegex(RuntimeError, "Explicit transmitter sounding IDs"):
                source.read_frame()
        finally:
            source.close()


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[str | bytes] = []

    async def send(self, value: str | bytes) -> None:
        self.sent.append(value)


class GatewayServerTests(unittest.IsolatedAsyncioTestCase):
    async def test_control_and_binary_stream_share_one_contract(self) -> None:
        source = MultiLinkWifiCsiSource(
            [("rx-a", FakeWifiCsiSource()), ("rx-b", FakeWifiCsiSource())]
        )
        source.connect()
        server = WifiCsiGatewayServer(
            source,
            config=WifiGatewayConfig(frame_rate_hz=100),
        )
        socket = FakeSocket()
        try:
            await server._handle_request(
                socket,  # type: ignore[arg-type]
                json.dumps({"id": "status-1", "type": "status", "payload": {}}),
            )
            status_response = json.loads(socket.sent[-1])
            self.assertTrue(status_response["ok"])
            self.assertEqual(status_response["payload"]["gateway"]["protocol"], "WCS1/WebSocket")
            self.assertEqual(status_response["payload"]["receiverCount"], 2)
            self.assertTrue(status_response["payload"]["supportsExplicitSoundingId"])

            await server._handle_request(
                socket,  # type: ignore[arg-type]
                json.dumps(
                    {
                        "id": "start-1",
                        "type": "start",
                        "payload": {"sessionId": "stream-test"},
                    }
                ),
            )
            for _ in range(100):
                binary = next((item for item in socket.sent if isinstance(item, bytes)), None)
                if binary is not None:
                    break
                await asyncio.sleep(0.01)
            else:
                self.fail("Gateway did not emit a WCS1 frame.")

            frame = decode_frame(binary)
            self.assertEqual(frame["sessionId"], "stream-test")
            self.assertIn(frame["rxNodeId"], {"rx-a", "rx-b"})
            self.assertEqual(frame["soundingIdSource"], "transmitter-payload")
            self.assertEqual(frame["soundingSessionNonce"], 0x5343414E)

            await server._handle_request(
                socket,  # type: ignore[arg-type]
                json.dumps({"id": "stop-1", "type": "stop", "payload": {}}),
            )
            stop_response = json.loads(socket.sent[-1])
            self.assertFalse(stop_response["payload"]["streaming"])
        finally:
            await server._stop_any_stream()
            source.close()


if __name__ == "__main__":
    unittest.main()
