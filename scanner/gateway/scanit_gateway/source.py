from __future__ import annotations

import math
import time
import uuid
from abc import ABC, abstractmethod
from typing import Any

from .config import FmcwConfig


class RadarSource(ABC):
    source_name: str

    @abstractmethod
    def connect(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def configure(self, config: FmcwConfig) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def read_frame(
        self,
        *,
        session_id: str,
        position: str,
        sequence: int,
    ) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def status(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def close(self) -> None:
        raise NotImplementedError


class FakeRadarSource(RadarSource):
    """Deterministic real-ADC FMCW cube used to test the physical path."""

    source_name = "deterministic-fake"

    def __init__(self) -> None:
        self._connected = False
        self._config = FmcwConfig()

    def connect(self) -> dict[str, Any]:
        self._connected = True
        return self.status()

    def configure(self, config: FmcwConfig) -> dict[str, Any]:
        config.validate()
        self._config = config
        return self.status()

    def read_frame(
        self,
        *,
        session_id: str,
        position: str,
        sequence: int,
    ) -> dict[str, Any]:
        if not self._connected:
            self.connect()
        frame_period = 1 / self._config.frame_rate_hz
        time.sleep(min(frame_period, 0.01))

        samples: list[float] = []
        target_bin = 9
        chirps = self._config.chirps_per_frame
        adc_samples = self._config.samples_per_chirp
        chirp_period = self._config.chirp_repetition_time_s
        frame_start = sequence * frame_period

        for channel in range(3):
            for chirp in range(chirps):
                slow_time = frame_start + chirp * chirp_period
                respiration_phase = 0.42 * math.sin(2 * math.pi * 0.24 * slow_time)
                cardiac_phase = 0.055 * math.sin(2 * math.pi * 1.15 * slow_time)
                channel_phase = channel * 0.17
                for sample in range(adc_samples):
                    range_angle = 2 * math.pi * target_bin * sample / adc_samples
                    value = 0.65 * math.cos(
                        range_angle + respiration_phase + cardiac_phase + channel_phase
                    )
                    value += 0.05 * math.cos(2 * math.pi * 3 * sample / adc_samples)
                    samples.extend((value, 0.0))

        return frame_metadata(
            config=self._config,
            session_id=session_id,
            position=position,
            sequence=sequence,
            samples=samples,
            channels=3,
            samples_per_channel=chirps * adc_samples,
            source=self.source_name,
            simulated=True,
            raw_cube_shape=[3, chirps, adc_samples],
        )

    def status(self) -> dict[str, Any]:
        return {
            "source": self.source_name,
            "deviceConnected": self._connected,
            "boardUuid": "fake-bgt60tr13c",
            "sdkVersion": "fake",
            "config": self._config.public_dict(),
        }

    def close(self) -> None:
        self._connected = False


def frame_metadata(
    *,
    config: FmcwConfig,
    session_id: str,
    position: str,
    sequence: int,
    samples: list[float],
    channels: int,
    samples_per_channel: int,
    source: str,
    simulated: bool,
    raw_cube_shape: list[int],
) -> dict[str, Any]:
    return {
        "frameId": str(uuid.uuid4()),
        "sessionId": session_id,
        "sequence": sequence,
        "timestampNs": str(time.time_ns()),
        "modality": "mmwave-fmcw",
        "position": position,
        "centerFrequencyHz": config.center_frequency_hz,
        "bandwidthHz": config.bandwidth_hz,
        "sampleRateHz": config.sample_rate_hz,
        "channels": channels,
        "samplesPerChannel": samples_per_channel,
        "sampleFormat": "real-adc-in-iq-container",
        "dataLayout": "rx-chirp-sample",
        "samples": samples,
        "antennaConfigurationId": f"bgt60tr13c-rx{config.rx_mask:02x}-tx{config.tx_mask:02x}",
        "acquisition": {
            "source": source,
            "frameRateHz": config.frame_rate_hz,
            "frameRepetitionTimeSeconds": 1 / config.frame_rate_hz,
            "chirpsPerFrame": config.chirps_per_frame,
            "chirpRepetitionTimeSeconds": config.chirp_repetition_time_s,
            "samplesPerChirp": config.samples_per_chirp,
            "rxMask": config.rx_mask,
            "txMask": config.tx_mask,
            "rawCubeShape": raw_cube_shape,
            "chirpReduction": "none",
            "adcSignalType": "real",
        },
        "qualityFlags": [],
        "isSimulated": simulated,
    }
