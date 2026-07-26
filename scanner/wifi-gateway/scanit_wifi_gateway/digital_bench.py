from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from typing import Any

from .ingress import (
    CSI0_HEADER_V2,
    CSI0_MAGIC,
    CSI0_VERSION_V2,
    CSI_STATUS_ANTENNA_INDEX_UNKNOWN,
    CSI_STATUS_PAYLOAD_TRUNCATED,
    CSI_STATUS_QUEUE_DROPS_PRESENT,
    CSI_STATUS_SOUNDING_CRC_VALID,
    CSI_STATUS_SOUNDING_ID_PRESENT,
    CSI_STATUS_TIMESTAMP_MATCHED,
    Csi0StreamParser,
    record_to_wcs1_frame,
)
from .source import WifiCsiSource, WifiGatewayConfig


@dataclass(frozen=True, slots=True)
class DigitalBenchFaultProfile:
    """Deterministic faults applied to one simulated CSI receiver node."""

    start_sounding_id: int = 0
    dropped_soundings: frozenset[int] = frozenset()
    missing_identity_soundings: frozenset[int] = frozenset()
    queue_drop_soundings: frozenset[int] = frozenset()
    truncated_soundings: frozenset[int] = frozenset()
    clock_drift_ppm: float = 0.0
    callback_delta_us: int = 120
    callback_jitter_us: int = 30
    phase_jump_at: int | None = None
    motion_burst_start: int | None = None
    motion_burst_end: int | None = None
    nonce_change_at: int | None = None
    alternate_nonce: int = 0x5343414F
    fragment_pattern: tuple[int, ...] = (1, 7, 19, 3, 64, 11)


@dataclass(frozen=True, slots=True)
class DigitalBenchScenario:
    name: str = "healthy"
    session_nonce: int = 0x5343414E
    calibration_soundings: int = 24
    respiration_hz: float = 0.24
    mechanical_hz: float = 1.18
    mechanical_harmonic_hz: float = 2.36
    multipath_drift_hz: float = 0.035
    noise_scale: float = 0.7
    csi_scale: float = 82.0
    receiver_faults: dict[int, DigitalBenchFaultProfile] = field(default_factory=dict)

    def faults_for(self, receiver_index: int) -> DigitalBenchFaultProfile:
        return self.receiver_faults.get(receiver_index, DigitalBenchFaultProfile())


def digital_bench_scenario(name: str, receiver_count: int) -> DigitalBenchScenario:
    """Return a deterministic scenario suitable for CLI and regression use."""

    if receiver_count < 1:
        raise ValueError("Digital bench requires at least one receiver.")
    profiles = {index: DigitalBenchFaultProfile() for index in range(receiver_count)}

    if name == "healthy":
        pass
    elif name == "start-offsets":
        profiles = {
            index: replace(profile, start_sounding_id=index * 3)
            for index, profile in profiles.items()
        }
    elif name == "lossy":
        if receiver_count > 1:
            profiles[1] = replace(
                profiles[1],
                dropped_soundings=frozenset({5, 6, 37, 91}),
            )
    elif name == "clock-drift":
        profiles = {
            index: replace(profile, clock_drift_ppm=(-140.0 + index * 140.0))
            for index, profile in profiles.items()
        }
    elif name == "motion-burst":
        profiles = {
            index: replace(profile, motion_burst_start=90, motion_burst_end=120)
            for index, profile in profiles.items()
        }
    elif name == "phase-jump":
        if receiver_count > 1:
            profiles[1] = replace(profiles[1], phase_jump_at=105)
    elif name == "queue-drop":
        profiles[0] = replace(profiles[0], queue_drop_soundings=frozenset({55}))
    elif name == "identity-fallback":
        profiles[0] = replace(profiles[0], missing_identity_soundings=frozenset({40, 41}))
    elif name == "nonce-change":
        profiles = {
            index: replace(profile, nonce_change_at=80)
            for index, profile in profiles.items()
        }
    elif name == "truncated-payload":
        profiles[0] = replace(profiles[0], truncated_soundings=frozenset({45}))
    else:
        raise ValueError(f"Unknown digital bench scenario: {name}")

    return DigitalBenchScenario(name=name, receiver_faults=profiles)


def _clip_int8(value: float) -> int:
    return max(-127, min(127, int(round(value))))


def _wire_byte(value: int) -> int:
    return value & 0xFF


def _noise(seed: int) -> float:
    value = math.sin(seed * 12.9898 + 78.233) * 43_758.5453
    return ((value - math.floor(value)) * 2.0) - 1.0


class DigitalBenchCsi0Source(WifiCsiSource):
    """Simulate an ESP32-C5 receiver at the actual CSI0 v2 wire boundary.

    The generated packet is fragmented as if it arrived over UART, decoded by
    ``Csi0StreamParser`` and only then converted to WCS1. This deliberately does
    not bypass ingress validation.
    """

    source_name = "digital-bench-csi0-v2"

    def __init__(
        self,
        receiver_index: int,
        scenario: DigitalBenchScenario | None = None,
    ) -> None:
        if receiver_index < 0:
            raise ValueError("receiver_index must be non-negative.")
        self._receiver_index = receiver_index
        self._scenario = scenario or DigitalBenchScenario()
        self._faults = self._scenario.faults_for(receiver_index)
        self._config = WifiGatewayConfig()
        self._parser = Csi0StreamParser()
        self._connected = False
        self._next_sounding_id = self._faults.start_sounding_id
        self._local_sequence = 0
        self._dropped_total = 0
        self._wire_packets = 0
        self._wire_bytes = 0
        self._fragment_count = 0
        self._skipped_soundings = 0
        self._transmitter_mac = bytes((0x02, 0x53, 0x43, 0x41, 0x4E, 0x01))

    def connect(self) -> dict[str, Any]:
        self._connected = True
        return self.status()

    def configure(self, config: WifiGatewayConfig) -> dict[str, Any]:
        config.validate()
        if config.session_id != self._config.session_id:
            self._next_sounding_id = self._faults.start_sounding_id
            self._local_sequence = 0
            self._dropped_total = 0
            self._parser = Csi0StreamParser()
        self._config = config
        return self.status()

    def read_frame(self) -> dict[str, Any]:
        if not self._connected:
            self.connect()
        while True:
            sounding_id = self._next_sounding_id & 0xFFFFFFFF
            self._next_sounding_id = (self._next_sounding_id + 1) & 0xFFFFFFFF
            if sounding_id in self._faults.dropped_soundings:
                self._skipped_soundings += 1
                continue
            packet = self._build_csi0_packet(sounding_id)
            records = []
            offset = 0
            pattern = self._faults.fragment_pattern or (len(packet),)
            fragment_index = 0
            while offset < len(packet):
                requested = pattern[fragment_index % len(pattern)]
                size = max(1, min(requested, len(packet) - offset))
                records.extend(self._parser.feed(packet[offset : offset + size]))
                offset += size
                fragment_index += 1
                self._fragment_count += 1
            if len(records) != 1:
                raise RuntimeError(
                    f"Digital bench CSI0 packet produced {len(records)} records instead of one."
                )
            self._wire_packets += 1
            self._wire_bytes += len(packet)
            return record_to_wcs1_frame(records[0], self._config.mapping())

    def _build_csi0_packet(self, sounding_id: int) -> bytes:
        interval_us = 1_000_000.0 / self._config.frame_rate_hz
        elapsed_seconds = sounding_id / self._config.frame_rate_hz
        transmitter_us = 10_000_000 + int(round(sounding_id * interval_us))
        drift_factor = 1.0 + self._faults.clock_drift_ppm / 1_000_000.0
        receiver_us = int(round(transmitter_us * drift_factor)) + self._receiver_index * 211
        jitter_span = max(0, self._faults.callback_jitter_us)
        jitter = (
            int(round(_noise(sounding_id * 31 + self._receiver_index * 97) * jitter_span))
            if jitter_span
            else 0
        )
        callback_delta = self._faults.callback_delta_us + jitter
        rx_driver_us = (transmitter_us + callback_delta) & 0xFFFFFFFF

        active = 0.0 if sounding_id < self._scenario.calibration_soundings else 1.0
        respiration = math.sin(2 * math.pi * self._scenario.respiration_hz * elapsed_seconds)
        mechanical = math.sin(2 * math.pi * self._scenario.mechanical_hz * elapsed_seconds)
        harmonic = math.sin(
            2 * math.pi * self._scenario.mechanical_harmonic_hz * elapsed_seconds
        )
        multipath = math.sin(
            2 * math.pi * self._scenario.multipath_drift_hz * elapsed_seconds
        )
        motion_burst = 0.0
        if (
            self._faults.motion_burst_start is not None
            and self._faults.motion_burst_end is not None
            and self._faults.motion_burst_start <= sounding_id <= self._faults.motion_burst_end
        ):
            motion_burst = 0.9 * math.sin(2 * math.pi * 3.7 * elapsed_seconds)
        phase_jump = (
            1.25
            if self._faults.phase_jump_at is not None
            and sounding_id >= self._faults.phase_jump_at
            else 0.0
        )

        receiver_phase = (-0.65, 0.42, 1.18, -1.32)[self._receiver_index % 4]
        receiver_gain = (1.0, 0.82, 0.64, 0.73)[self._receiver_index % 4]
        motion_coupling = (1.0, -0.74, 0.31, -0.46)[self._receiver_index % 4]
        payload = bytearray()
        for position, subcarrier in enumerate(self._config.subcarrier_indices):
            phase = (
                receiver_phase
                + subcarrier * (0.019 + self._receiver_index * 0.0025)
                + 0.16 * math.sin(subcarrier * 0.21 + receiver_phase)
                + active
                * motion_coupling
                * (0.31 * respiration + 0.057 * mechanical + 0.018 * harmonic)
                + active * 0.025 * multipath * (0.4 + abs(subcarrier) / 56.0)
                + motion_burst
                + phase_jump
            )
            magnitude = receiver_gain * (
                0.92
                + 0.025 * math.sin(subcarrier * 0.17 + receiver_phase)
                + active * 0.009 * respiration
            )
            seed = sounding_id * 10_000 + self._receiver_index * 1_000 + position
            real = _clip_int8(
                self._scenario.csi_scale * magnitude * math.cos(phase)
                + _noise(seed) * self._scenario.noise_scale
            )
            imaginary = _clip_int8(
                self._scenario.csi_scale * magnitude * math.sin(phase)
                + _noise(seed + 317) * self._scenario.noise_scale
            )
            payload.extend((_wire_byte(imaginary), _wire_byte(real)))

        status_flags = (
            CSI_STATUS_SOUNDING_ID_PRESENT
            | CSI_STATUS_SOUNDING_CRC_VALID
            | CSI_STATUS_TIMESTAMP_MATCHED
            | CSI_STATUS_ANTENNA_INDEX_UNKNOWN
        )
        nonce = self._scenario.session_nonce
        encoded_sounding_id = sounding_id
        if sounding_id in self._faults.missing_identity_soundings:
            status_flags &= ~(
                CSI_STATUS_SOUNDING_ID_PRESENT
                | CSI_STATUS_SOUNDING_CRC_VALID
                | CSI_STATUS_TIMESTAMP_MATCHED
            )
            nonce = 0
            encoded_sounding_id = 0xFFFFFFFF
        if (
            self._faults.nonce_change_at is not None
            and sounding_id >= self._faults.nonce_change_at
        ):
            nonce = self._faults.alternate_nonce
        if sounding_id in self._faults.queue_drop_soundings:
            self._dropped_total += 1
        if self._dropped_total:
            status_flags |= CSI_STATUS_QUEUE_DROPS_PRESENT
        if sounding_id in self._faults.truncated_soundings:
            status_flags |= CSI_STATUS_PAYLOAD_TRUNCATED
            payload = payload[:-4]

        header = CSI0_HEADER_V2.pack(
            CSI0_MAGIC,
            CSI0_VERSION_V2,
            CSI0_HEADER_V2.size,
            self._local_sequence,
            encoded_sounding_id,
            nonce,
            receiver_us,
            transmitter_us,
            rx_driver_us,
            callback_delta,
            self._transmitter_mac,
            -42 - self._receiver_index * 4,
            -94,
            self._config.channel,
            0,
            0,
            0,
            0,
            0,
            status_flags,
            self._dropped_total,
            len(payload),
        )
        self._local_sequence = (self._local_sequence + 1) & 0xFFFFFFFF
        return header + bytes(payload)

    def status(self) -> dict[str, Any]:
        return {
            "source": self.source_name,
            "firmwareVersion": "digital-bench-csi0-v2",
            "deviceConnected": self._connected,
            "supportsRawCsi": True,
            "supportsExplicitSoundingId": True,
            "explicitSubcarrierMap": True,
            "benchScenario": self._scenario.name,
            "benchReceiverIndex": self._receiver_index,
            "csi0RecordsDecoded": self._parser.records_decoded,
            "csi0V2RecordsDecoded": self._parser.v2_records_decoded,
            "receiverDroppedRecordCount": self._dropped_total,
            "benchWirePackets": self._wire_packets,
            "benchWireBytes": self._wire_bytes,
            "benchFragments": self._fragment_count,
            "benchSkippedSoundings": self._skipped_soundings,
            "benchClockDriftPpm": self._faults.clock_drift_ppm,
            "config": self._config.public_dict(),
        }

    def close(self) -> None:
        self._connected = False
