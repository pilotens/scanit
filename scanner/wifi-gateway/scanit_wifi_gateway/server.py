from __future__ import annotations

import asyncio
import contextlib
import json
from dataclasses import dataclass
from typing import Any

from websockets.asyncio.server import ServerConnection, serve

from .protocol import encode_frame
from .source import WifiCsiSource, WifiGatewayConfig


@dataclass(slots=True)
class ActiveStream:
    task: asyncio.Task[None]
    owner: ServerConnection
    session_id: str


class WifiCsiGatewayServer:
    """JSON control and binary WCS1 streaming for one logical Wi-Fi sensing rig."""

    def __init__(
        self,
        source: WifiCsiSource,
        *,
        host: str = "0.0.0.0",
        port: int = 8770,
        config: WifiGatewayConfig | None = None,
    ) -> None:
        self.source = source
        self.host = host
        self.port = port
        self.config = config or WifiGatewayConfig()
        self._active: ActiveStream | None = None
        self._stream_lock = asyncio.Lock()

    async def run(self) -> None:
        await asyncio.to_thread(self.source.connect)
        await asyncio.to_thread(self.source.configure, self.config)
        try:
            async with serve(
                self._handle_client,
                self.host,
                self.port,
                max_size=4 * 1024 * 1024,
                max_queue=32,
                ping_interval=20,
                ping_timeout=20,
            ):
                await asyncio.Future()
        finally:
            await self._stop_any_stream()
            await asyncio.to_thread(self.source.close)

    async def _handle_client(self, socket: ServerConnection) -> None:
        await socket.send(
            json.dumps(
                {
                    "type": "event",
                    "event": "gateway-ready",
                    "payload": self._status(),
                }
            )
        )
        try:
            async for message in socket:
                if isinstance(message, bytes):
                    await self._send_error(
                        socket,
                        None,
                        "Binary client messages are not supported.",
                    )
                    continue
                await self._handle_request(socket, message)
        finally:
            await self._stop_stream(owner=socket)

    async def _handle_request(self, socket: ServerConnection, raw: str) -> None:
        request_id: str | None = None
        try:
            request = json.loads(raw)
            request_id = request.get("id")
            request_type = request.get("type")
            payload = request.get("payload") or {}
            if not isinstance(request_id, str) or not request_id:
                raise ValueError("Control request requires a non-empty id.")
            if not isinstance(request_type, str) or not request_type:
                raise ValueError("Control request requires a type.")
            if not isinstance(payload, dict):
                raise ValueError("Control payload must be an object.")

            if request_type == "status":
                result = self._status()
            elif request_type == "configure":
                if self._active is not None:
                    raise RuntimeError("Stop the active CSI stream before reconfiguration.")
                self.config = self.config.apply_payload(payload)
                result = await asyncio.to_thread(self.source.configure, self.config)
            elif request_type == "calibrate":
                # Calibration is intentionally captured as ordinary raw WCS1 data.
                # The app derives and versions the CSI baseline from those frames.
                result = {
                    **self._status(),
                    "calibrationMode": "raw-wcs1-capture",
                }
            elif request_type == "start":
                result = await self._start_stream(socket, payload)
            elif request_type == "stop":
                await self._stop_stream(owner=socket)
                result = self._status()
            elif request_type == "ping":
                result = {"pong": True}
            else:
                raise ValueError(f"Unsupported control request: {request_type}")

            await self._send_response(socket, request_id, result)
        except Exception as error:
            await self._send_error(socket, request_id, str(error))

    async def _start_stream(
        self,
        socket: ServerConnection,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        session_id = str(payload.get("sessionId") or self.config.session_id)
        async with self._stream_lock:
            if self._active is not None:
                if self._active.owner is socket:
                    await self._stop_stream(owner=socket, lock_held=True)
                else:
                    raise RuntimeError("Wi-Fi CSI stream is already owned by another client.")
            self.config = self.config.apply_payload({"sessionId": session_id})
            await asyncio.to_thread(self.source.connect)
            await asyncio.to_thread(self.source.configure, self.config)
            task = asyncio.create_task(self._stream_frames(socket))
            self._active = ActiveStream(
                task=task,
                owner=socket,
                session_id=session_id,
            )
        return self._status()

    async def _stream_frames(self, socket: ServerConnection) -> None:
        try:
            while True:
                frame = await asyncio.to_thread(self.source.read_frame)
                await socket.send(encode_frame(frame))
        except asyncio.CancelledError:
            raise
        except Exception as error:
            with contextlib.suppress(Exception):
                await socket.send(
                    json.dumps(
                        {
                            "type": "event",
                            "event": "stream-error",
                            "payload": {"message": str(error)},
                        }
                    )
                )
        finally:
            if self._active and self._active.task is asyncio.current_task():
                self._active = None

    async def _stop_any_stream(self) -> None:
        async with self._stream_lock:
            active = self._active
            if active is None:
                return
            self._active = None
            active.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await active.task

    async def _stop_stream(
        self,
        owner: ServerConnection,
        lock_held: bool = False,
    ) -> None:
        if not lock_held:
            async with self._stream_lock:
                await self._stop_stream(owner, lock_held=True)
            return
        active = self._active
        if active is None or active.owner is not owner:
            return
        self._active = None
        active.task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await active.task

    def _status(self) -> dict[str, Any]:
        source_status = self.source.status()
        receiver_ids = source_status.get("receiverNodeIds")
        if not isinstance(receiver_ids, list):
            receiver_id = self.config.rx_node_id
            receiver_ids = [receiver_id] if receiver_id else []
        return {
            **source_status,
            "streaming": self._active is not None,
            "streamSessionId": self._active.session_id if self._active else None,
            "receiverNodeIds": receiver_ids,
            "receiverCount": len(receiver_ids),
            "config": self.config.public_dict(),
            "gateway": {
                "host": self.host,
                "port": self.port,
                "protocol": "WCS1/WebSocket",
                "controlVersion": 1,
            },
        }

    @staticmethod
    async def _send_response(
        socket: ServerConnection,
        request_id: str,
        payload: Any,
    ) -> None:
        await socket.send(
            json.dumps(
                {
                    "type": "response",
                    "requestId": request_id,
                    "ok": True,
                    "payload": payload,
                }
            )
        )

    @staticmethod
    async def _send_error(
        socket: ServerConnection,
        request_id: str | None,
        message: str,
    ) -> None:
        await socket.send(
            json.dumps(
                {
                    "type": "response",
                    "requestId": request_id,
                    "ok": False,
                    "error": message,
                }
            )
        )
