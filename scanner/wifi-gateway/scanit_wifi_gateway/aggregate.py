from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from typing import Any

from .source import WifiCsiSource, WifiGatewayConfig

SoundingKey = tuple[int, int]


class MultiLinkWifiCsiSource(WifiCsiSource):
    """Aggregate receiver sources into one WCS1 stream.

    CSI0 v2 sources are paired by the transmitter-provided
    ``(session nonce, sounding id)`` key. CSI0 v1 / legacy sources may only use
    software batch alignment when ``require_explicit_sounding_id`` is disabled.
    """

    source_name = "multi-link-wifi-csi"
    _maximum_alignment_reads = 32
    _maximum_buffered_soundings = 128

    def __init__(self, sources: list[tuple[str, WifiCsiSource]]) -> None:
        if len(sources) < 2:
            raise ValueError("Multi-link Wi-Fi sensing requires at least two receiver sources.")
        receiver_ids = [receiver_id for receiver_id, _ in sources]
        if len(set(receiver_ids)) != len(receiver_ids):
            raise ValueError("Receiver source identifiers must be unique.")
        self._sources = sources
        self._executor = ThreadPoolExecutor(
            max_workers=len(sources),
            thread_name_prefix="scanit-wifi-csi",
        )
        self._connected = False
        self._config = WifiGatewayConfig()
        self._pending: list[dict[str, Any]] = []
        self._buffers: dict[str, dict[SoundingKey, dict[str, Any]]] = {
            receiver_id: {} for receiver_id, _ in sources
        }
        self._fallback_sounding_sequence = 0
        self._frame_sequence = 0
        self._clock_domain = f"wifi-gateway-{time.monotonic_ns()}"
        self._active_sounding_nonce: int | None = None
        self._last_explicit_sounding_id: int | None = None
        self._explicit_batches = 0
        self._fallback_batches = 0
        self._duplicate_frames = 0
        self._discarded_unpaired_frames = 0
        self._transmitter_sounding_gaps = 0

    def connect(self) -> dict[str, Any]:
        futures = [self._executor.submit(source.connect) for _, source in self._sources]
        for future in futures:
            future.result()
        self._connected = True
        return self.status()

    def configure(self, config: WifiGatewayConfig) -> dict[str, Any]:
        config.validate()
        session_changed = config.session_id != self._config.session_id
        self._config = config
        futures = []
        for receiver_id, source in self._sources:
            child_config = replace(
                config,
                rx_node_id=receiver_id,
                clock_domain=f"{self._clock_domain}:{receiver_id}",
            )
            futures.append(self._executor.submit(source.configure, child_config))
        for future in futures:
            future.result()
        if session_changed:
            self._reset_session_state()
        return self.status()

    def _reset_session_state(self) -> None:
        self._pending.clear()
        for buffer in self._buffers.values():
            buffer.clear()
        self._fallback_sounding_sequence = 0
        self._frame_sequence = 0
        self._active_sounding_nonce = None
        self._last_explicit_sounding_id = None
        self._explicit_batches = 0
        self._fallback_batches = 0
        self._duplicate_frames = 0
        self._discarded_unpaired_frames = 0
        self._transmitter_sounding_gaps = 0

    def read_frame(self) -> dict[str, Any]:
        if not self._connected:
            self.connect()
        if not self._pending:
            self._capture_batch()
        return self._pending.pop(0)

    @staticmethod
    def _explicit_key(frame: dict[str, Any]) -> SoundingKey | None:
        if frame.get("soundingIdSource") != "transmitter-payload":
            return None
        nonce = frame.get("soundingSessionNonce")
        sounding_id = frame.get("soundingSequence")
        if not isinstance(nonce, int) or not isinstance(sounding_id, int):
            return None
        if nonce < 0 or sounding_id < 0:
            return None
        return nonce, sounding_id

    def _read_all_sources(self) -> list[tuple[str, dict[str, Any]]]:
        futures = [
            (receiver_id, self._executor.submit(source.read_frame))
            for receiver_id, source in self._sources
        ]
        return [(receiver_id, future.result()) for receiver_id, future in futures]

    def _buffer_explicit_frames(
        self,
        frames: list[tuple[str, dict[str, Any]]],
    ) -> None:
        for receiver_id, frame in frames:
            key = self._explicit_key(frame)
            if key is None:
                raise RuntimeError(
                    "Mixed explicit and fallback sounding identities cannot be aggregated."
                )
            buffer = self._buffers[receiver_id]
            if key in buffer:
                self._duplicate_frames += 1
            else:
                buffer[key] = frame
            while len(buffer) > self._maximum_buffered_soundings:
                oldest = min(buffer)
                del buffer[oldest]
                self._discarded_unpaired_frames += 1

    def _take_common_explicit_batch(self) -> tuple[SoundingKey, list[dict[str, Any]]] | None:
        key_sets = [set(buffer) for buffer in self._buffers.values()]
        if not key_sets or any(not keys for keys in key_sets):
            return None
        common = set.intersection(*key_sets)
        if not common:
            return None
        key = min(common)
        nonce, sounding_id = key
        if self._active_sounding_nonce is None:
            self._active_sounding_nonce = nonce
        elif nonce != self._active_sounding_nonce:
            raise RuntimeError(
                "The sounding transmitter session nonce changed during an active capture."
            )

        frames: list[dict[str, Any]] = []
        for receiver_id, _source in self._sources:
            buffer = self._buffers[receiver_id]
            frames.append(buffer.pop(key))
            stale = [candidate for candidate in buffer if candidate < key]
            for candidate in stale:
                del buffer[candidate]
                self._discarded_unpaired_frames += 1

        if self._last_explicit_sounding_id is not None:
            expected = (self._last_explicit_sounding_id + 1) & 0xFFFFFFFF
            if sounding_id != expected:
                distance = (sounding_id - expected) & 0xFFFFFFFF
                self._transmitter_sounding_gaps += max(1, distance)
        self._last_explicit_sounding_id = sounding_id
        return key, frames

    def _capture_batch(self) -> None:
        batch_started_ns = time.monotonic_ns()
        first_frames = self._read_all_sources()
        explicit_count = sum(
            self._explicit_key(frame) is not None for _, frame in first_frames
        )

        if explicit_count == len(first_frames):
            self._buffer_explicit_frames(first_frames)
            matched = self._take_common_explicit_batch()
            attempts = 1
            while matched is None and attempts < self._maximum_alignment_reads:
                self._buffer_explicit_frames(self._read_all_sources())
                matched = self._take_common_explicit_batch()
                attempts += 1
            if matched is None:
                raise TimeoutError(
                    "Receiver nodes did not produce a common transmitter sounding ID."
                )
            key, frames = matched
            self._emit_batch(
                frames,
                batch_started_ns=batch_started_ns,
                explicit_key=key,
            )
            self._explicit_batches += 1
            return

        if explicit_count:
            raise RuntimeError(
                "Some receiver nodes expose transmitter sounding IDs while others do not."
            )
        if self._config.require_explicit_sounding_id:
            raise RuntimeError(
                "Explicit transmitter sounding IDs are required, but all nodes used fallback sequences."
            )

        self._emit_batch(
            [frame for _, frame in first_frames],
            batch_started_ns=batch_started_ns,
            explicit_key=None,
        )
        self._fallback_batches += 1
        self._fallback_sounding_sequence += 1

    def _emit_batch(
        self,
        frames: list[dict[str, Any]],
        *,
        batch_started_ns: int,
        explicit_key: SoundingKey | None,
    ) -> None:
        batch_ended_ns = time.monotonic_ns()
        midpoint_ns = batch_started_ns + (batch_ended_ns - batch_started_ns) // 2
        maximum_child_uncertainty_ns = max(
            (
                int((frame.get("timing") or {}).get("uncertaintyNs") or 0)
                for frame in frames
            ),
            default=0,
        )
        timing_uncertainty_ns = (
            max(1, (batch_ended_ns - batch_started_ns) // 2)
            + maximum_child_uncertainty_ns
        )
        wall_clock_ns = time.time_ns()
        explicit = explicit_key is not None
        sounding_sequence = (
            explicit_key[1]
            if explicit_key is not None
            else self._fallback_sounding_sequence
        )
        flags = [
            "explicit-transmitter-sounding-id"
            if explicit
            else "software-aligned-multinode",
            "gateway-clock-mapped",
        ]
        if timing_uncertainty_ns > 20_000_000:
            flags.append("multinode-timing-uncertain")
        if explicit and self._transmitter_sounding_gaps:
            flags.append("transmitter-sounding-gap-observed")
        if self._discarded_unpaired_frames:
            flags.append("unpaired-receiver-frames-discarded")

        for frame in frames:
            original_sequence = int(frame.get("sequence") or 0)
            original_timing = frame.get("timing")
            frame["receiverOriginalTiming"] = original_timing
            frame["packetSequence"] = int(
                frame.get("packetSequence")
                if frame.get("packetSequence") is not None
                else original_sequence
            )
            frame["sequence"] = self._frame_sequence
            frame["soundingSequence"] = sounding_sequence
            frame["soundingIdSource"] = (
                "transmitter-payload" if explicit else "gateway-software-aligned"
            )
            if explicit_key is not None:
                frame["soundingSessionNonce"] = explicit_key[0]
            frame["frameId"] = (
                f"{self._config.session_id}-{frame['rxNodeId']}-{self._frame_sequence}"
            )
            frame["sessionId"] = self._config.session_id
            frame["timestampNs"] = str(midpoint_ns)
            frame["timing"] = {
                "clockDomain": self._clock_domain,
                "timestampSource": (
                    "wifi-gateway-explicit-sounding-aligned"
                    if explicit
                    else "wifi-gateway-software-aligned"
                ),
                "monotonicTimestampNs": str(midpoint_ns),
                "wallClockUnixNs": str(wall_clock_ns),
                "uncertaintyNs": timing_uncertainty_ns,
                "acquisitionStartedMonotonicNs": str(batch_started_ns),
                "acquisitionEndedMonotonicNs": str(batch_ended_ns),
            }
            frame["source"] = self.source_name
            frame["qualityFlags"] = list(
                dict.fromkeys([*(frame.get("qualityFlags") or []), *flags])
            )
            self._frame_sequence += 1
            self._pending.append(frame)

    def status(self) -> dict[str, Any]:
        child_statuses = [source.status() for _, source in self._sources]
        return {
            "source": self.source_name,
            "deviceConnected": self._connected
            and all(bool(status.get("deviceConnected")) for status in child_statuses),
            "supportsRawCsi": all(
                bool(status.get("supportsRawCsi")) for status in child_statuses
            ),
            "supportsExplicitSoundingId": all(
                bool(status.get("supportsExplicitSoundingId"))
                for status in child_statuses
            ),
            "supportsSharedClock": False,
            "softwareAlignedClock": True,
            "clockDomain": self._clock_domain,
            "receiverNodeIds": [receiver_id for receiver_id, _ in self._sources],
            "receiverCount": len(self._sources),
            "childSources": child_statuses,
            "explicitSoundingBatches": self._explicit_batches,
            "fallbackSoundingBatches": self._fallback_batches,
            "duplicateReceiverFrames": self._duplicate_frames,
            "discardedUnpairedFrames": self._discarded_unpaired_frames,
            "transmitterSoundingGaps": self._transmitter_sounding_gaps,
            "activeSoundingSessionNonce": self._active_sounding_nonce,
            "config": self._config.public_dict(),
        }

    def close(self) -> None:
        for _, source in self._sources:
            source.close()
        self._connected = False
        self._pending.clear()
        for buffer in self._buffers.values():
            buffer.clear()
        self._executor.shutdown(wait=True, cancel_futures=True)
