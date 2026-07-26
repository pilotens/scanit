from __future__ import annotations

import asyncio
import contextlib
import json
from dataclasses import dataclass
from typing import Any

from websockets.asyncio.server import ServerConnection, serve

from .config import FmcwConfig
from .protocol import encode_frame
from .source import RadarSource


@dataclass(slots=True)
class ActiveStream:
    task: asyncio.Task[None]
    owner: ServerConnection
    session_id: str
    position: str


class ScannerGatewayServer:
    def __init__(self, source: RadarSource, host: str = "0.0.0.0", port: int = 8765) -> None:
        self.source = source
        self.host = host
        self.port = port
        self.config = FmcwConfig()
        self._active: ActiveStream | None = None
        self._stream_lock = asyncio.Lock()

    async def run(self) -> None:
        await asyncio.to_thread(self.source.connect)
        async with serve(
            self._handle_client,
            self.host,
            self.port,
            max_size=2 * 1024 * 1024,
            ping_interval=20,
            ping_timeout=20,
        ):
            await asyncio.Future()

    async def _handle_client(self, socket: ServerConnection) -> None:
        await socket.send(json.dumps({"type": "event", "event": "gateway-ready", "payload": self._status()}))
        try:
            async for message in socket:
                if isinstance(message, bytes):
                    await self._send_error(socket, None, "Binary client messages are not supported.")
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
            if not isinstance(request_type, str):
                raise ValueError("Control request requires a type.")
            if not isinstance(payload, dict):
                raise ValueError("Control payload must be an object.")

            if request_type == "status":
                result = self._status()
            elif request_type == "configure":
                self.config = self.config.apply_payload(payload)
                result = await asyncio.to_thread(self.source.configure, self.config)
            elif request_type == "calibrate":
                result = await asyncio.to_thread(self.source.configure, self.config)
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

    async def _start_stream(self, socket: ServerConnection, payload: dict[str, Any]) -> dict[str, Any]:
        session_id = str(payload.get("sessionId") or "physical-session")
        position = str(payload.get("position") or "left-sternal")
        async with self._stream_lock:
            if self._active is not None:
                if self._active.owner is socket:
                    await self._stop_stream(owner=socket, lock_held=True)
                else:
                    raise RuntimeError("Radar stream is already owned by another client.")
            await asyncio.to_thread(self.source.connect)
            task = asyncio.create_task(self._stream_frames(socket, session_id, position))
            self._active = ActiveStream(task=task, owner=socket, session_id=session_id, position=position)
        return self._status()

    async def _stream_frames(self, socket: ServerConnection, session_id: str, position: str) -> None:
        sequence = 0
        try:
            while True:
                frame = await asyncio.to_thread(
                    self.source.read_frame,
                    session_id=session_id,
                    position=position,
                    sequence=sequence,
                )
                await socket.send(encode_frame(frame))
                sequence += 1
        except asyncio.CancelledError:
            raise
        except Exception as error:
            with contextlib.suppress(Exception):
                await socket.send(json.dumps({
                    "type": "event",
                    "event": "stream-error",
                    "payload": {"message": str(error)},
                }))
        finally:
            if self._active and self._active.task is asyncio.current_task():
                self._active = None

    async def _stop_stream(self, owner: ServerConnection, lock_held: bool = False) -> None:
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
        return {
            **source_status,
            "streaming": self._active is not None,
            "streamSessionId": self._active.session_id if self._active else None,
            "streamPosition": self._active.position if self._active else None,
            "gateway": {"host": self.host, "port": self.port, "protocol": "SCN1/WebSocket"},
        }

    @staticmethod
    async def _send_response(socket: ServerConnection, request_id: str, payload: Any) -> None:
        await socket.send(json.dumps({
            "type": "response",
            "requestId": request_id,
            "ok": True,
            "payload": payload,
        }))

    @staticmethod
    async def _send_error(socket: ServerConnection, request_id: str | None, message: str) -> None:
        await socket.send(json.dumps({
            "type": "response",
            "requestId": request_id,
            "ok": False,
            "error": message,
        }))
