from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from typing import Any


@dataclass(frozen=True, slots=True)
class FmcwConfig:
    start_frequency_hz: int = 58_000_000_000
    end_frequency_hz: int = 63_000_000_000
    sample_rate_hz: int = 2_000_000
    samples_per_chirp: int = 128
    chirps_per_frame: int = 32
    frame_rate_hz: float = 20.0
    chirp_repetition_time_s: float = 0.0005
    rx_mask: int = 0b111
    tx_mask: int = 0b001
    tx_power_level: int = 31
    low_pass_cutoff_hz: int = 500_000
    high_pass_cutoff_hz: int = 80_000
    if_gain_db: int = 33

    @property
    def center_frequency_hz(self) -> float:
        return (self.start_frequency_hz + self.end_frequency_hz) / 2

    @property
    def bandwidth_hz(self) -> int:
        return self.end_frequency_hz - self.start_frequency_hz

    def validate(self) -> None:
        if self.start_frequency_hz <= 0 or self.end_frequency_hz <= self.start_frequency_hz:
            raise ValueError("Invalid FMCW frequency sweep.")
        if self.samples_per_chirp <= 0 or self.samples_per_chirp & (self.samples_per_chirp - 1):
            raise ValueError("samples_per_chirp must be a positive power of two.")
        if self.chirps_per_frame <= 0:
            raise ValueError("chirps_per_frame must be positive.")
        if self.frame_rate_hz <= 0:
            raise ValueError("frame_rate_hz must be positive.")
        if self.rx_mask <= 0 or self.tx_mask <= 0:
            raise ValueError("At least one RX and one TX antenna must be enabled.")

    def apply_payload(self, payload: dict[str, Any]) -> "FmcwConfig":
        aliases = {
            "startFrequencyHz": "start_frequency_hz",
            "endFrequencyHz": "end_frequency_hz",
            "sampleRateHz": "sample_rate_hz",
            "samplesPerChirp": "samples_per_chirp",
            "chirpsPerFrame": "chirps_per_frame",
            "frameRateHz": "frame_rate_hz",
            "chirpRepetitionTimeSeconds": "chirp_repetition_time_s",
            "rxMask": "rx_mask",
            "txMask": "tx_mask",
            "txPowerLevel": "tx_power_level",
            "lowPassCutoffHz": "low_pass_cutoff_hz",
            "highPassCutoffHz": "high_pass_cutoff_hz",
            "ifGainDb": "if_gain_db",
        }
        allowed = set(asdict(self))
        changes: dict[str, Any] = {}
        for key, value in payload.items():
            normalized = aliases.get(key, key)
            if normalized in allowed:
                changes[normalized] = value
        updated = replace(self, **changes)
        updated.validate()
        return updated

    def public_dict(self) -> dict[str, Any]:
        return {
            "startFrequencyHz": self.start_frequency_hz,
            "endFrequencyHz": self.end_frequency_hz,
            "centerFrequencyHz": self.center_frequency_hz,
            "bandwidthHz": self.bandwidth_hz,
            "sampleRateHz": self.sample_rate_hz,
            "samplesPerChirp": self.samples_per_chirp,
            "chirpsPerFrame": self.chirps_per_frame,
            "frameRateHz": self.frame_rate_hz,
            "chirpRepetitionTimeSeconds": self.chirp_repetition_time_s,
            "rxMask": self.rx_mask,
            "txMask": self.tx_mask,
            "txPowerLevel": self.tx_power_level,
            "lowPassCutoffHz": self.low_pass_cutoff_hz,
            "highPassCutoffHz": self.high_pass_cutoff_hz,
            "ifGainDb": self.if_gain_db,
        }
