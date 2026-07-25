from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from typing import Any

from .source import WifiCsiSource, WifiGatewayConfig


class MultiLinkWifiCsiSource(WifiCsiSource):
    """Aggregate several receiver sources into one software-aligned WCS1 stream.

    Each acquisition batch reads all receiver sources concurrently, assigns one
    shared sounding sequence, and maps the frames into a gateway-monotonic clock
    domain. This is a quantified software fallback. Physical research that
    requires tighter phase/time coherence should use a common hardware trigger.
    """

    source_name = "multi-link-wifi-csi"

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
        self._sounding_sequence = 0
        self._frame_sequence = 0
        self._clock_domain = f"wifi-gateway-{time.monotonic_ns()}"

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
            self._pending.clear()
            self._sounding_sequence = 0
            self._frame_sequence = 0
        return self.status()

    def read_frame(self) -> dict[str, Any]:
        if not self._connected:
            self.connect()
        if not self._pending:
            self._capture_batch()
        return self._pending.pop(0)

    def _capture_batch(self) -> None:
        batch_started_ns = time.monotonic_ns()
        futures = [
            (receiver_id, self._executor.submit(source.read_frame))
            for receiver_id, source in self._sources
        ]
        frames: list[dict[str, Any]] = []
        maximum_child_uncertainty_ns = 0
        for receiver_id, future in futures:
            frame = future.result()
            frame["rxNodeId"] = receiver_id
            child_timing = frame.get("timing") or {}
            maximum_child_uncertainty_ns = max(
                maximum_child_uncertainty_ns,
                int(child_timing.get("uncertaintyNs") or 0),
            )
            frames.append(frame)
        batch_ended_ns = time.monotonic_ns()
        midpoint_ns = batch_started_ns + (batch_ended_ns - batch_started_ns) // 2
        timing_uncertainty_ns = (
            max(1, (batch_ended_ns - batch_started_ns) // 2)
            + maximum_child_uncertainty_ns
        )
        wall_clock_ns = time.time_ns()
        flags = ["software-aligned-multinode"]
        if timing_uncertainty_ns > 20_000_000:
            flags.append("multinode-timing-uncertain")

        for frame in frames:
            original_sequence = int(frame.get("sequence") or 0)
            frame["packetSequence"] = int(
                frame.get("packetSequence")
                if frame.get("packetSequence") is not None
                else original_sequence
            )
            frame["sequence"] = self._frame_sequence
            frame["soundingSequence"] = self._sounding_sequence
            frame["frameId"] = (
                f"{self._config.session_id}-{frame['rxNodeId']}-{self._frame_sequence}"
            )
            frame["sessionId"] = self._config.session_id
            frame["timestampNs"] = str(midpoint_ns)
            frame["timing"] = {
                "clockDomain": self._clock_domain,
                "timestampSource": "wifi-gateway-software-aligned",
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
        self._sounding_sequence += 1

    def status(self) -> dict[str, Any]:
        child_statuses = [source.status() for _, source in self._sources]
        return {
            "source": self.source_name,
            "deviceConnected": self._connected
            and all(bool(status.get("deviceConnected")) for status in child_statuses),
            "supportsRawCsi": all(
                bool(status.get("supportsRawCsi")) for status in child_statuses
            ),
            "supportsSharedClock": False,
            "softwareAlignedClock": True,
            "clockDomain": self._clock_domain,
            "receiverNodeIds": [receiver_id for receiver_id, _ in self._sources],
            "receiverCount": len(self._sources),
            "childSources": child_statuses,
            "config": self._config.public_dict(),
        }

    def close(self) -> None:
        for _, source in self._sources:
            source.close()
        self._connected = False
        self._pending.clear()
        self._executor.shutdown(wait=True, cancel_futures=True)
