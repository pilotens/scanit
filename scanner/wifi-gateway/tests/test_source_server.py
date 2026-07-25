from __future__ import annotations

import asyncio
import json
import unittest

from scanit_wifi_gateway.aggregate import MultiLinkWifiCsiSource
from scanit_wifi_gateway.protocol import decode_frame
from scanit_wifi_gateway.server import WifiCsiGatewayServer
from scanit_wifi_gateway.source import FakeWifiCsiSource, WifiGatewayConfig


class MultiLinkSourceTests(unittest.TestCase):
    def test_software_aligns_multiple_receiver_links(self) -> None:
        source = MultiLinkWifiCsiSource(
            [
                ("rx-left", FakeWifiCsiSource()),
                ("rx-right", FakeWifiCsiSource()),
                ("rx-reference", FakeWifiCsiSource()),
            ]
        )
        try:
            source.connect()
            source.configure(
                WifiGatewayConfig(
                    session_id="multi-test",
                    frame_rate_hz=100,
                )
            )
            frames = [source.read_frame() for _ in range(6)]
        finally:
            source.close()

        first_sounding = frames[:3]
        second_sounding = frames[3:]
        self.assertEqual({frame["soundingSequence"] for frame in first_sounding}, {0})
        self.assertEqual({frame["soundingSequence"] for frame in second_sounding}, {1})
        self.assertEqual(
            {frame["rxNodeId"] for frame in first_sounding},
            {"rx-left", "rx-right", "rx-reference"},
        )
        self.assertEqual(len({frame["sequence"] for frame in frames}), 6)
        self.assertEqual(len({frame["timing"]["clockDomain"] for frame in frames}), 1)
        self.assertTrue(
            all("software-aligned-multinode" in frame["qualityFlags"] for frame in frames)
        )


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
            for _ in range(50):
                binary = next((item for item in socket.sent if isinstance(item, bytes)), None)
                if binary is not None:
                    break
                await asyncio.sleep(0.01)
            else:
                self.fail("Gateway did not emit a WCS1 frame.")

            frame = decode_frame(binary)
            self.assertEqual(frame["sessionId"], "stream-test")
            self.assertIn(frame["rxNodeId"], {"rx-a", "rx-b"})

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
