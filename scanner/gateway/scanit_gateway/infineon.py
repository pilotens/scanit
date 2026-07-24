from __future__ import annotations

from typing import Any

from .config import FmcwConfig
from .source import RadarSource, frame_metadata


class InfineonRdkUnavailable(RuntimeError):
    pass


class InfineonRdkSource(RadarSource):
    """USB source backed by Infineon's Radar Development Kit Python wheel."""

    source_name = "infineon-rdk"

    def __init__(self, board_uuid: str | None = None) -> None:
        self._board_uuid = board_uuid
        self._device: Any | None = None
        self._config = FmcwConfig()
        self._sdk_version: str | None = None

    def _load_sdk(self) -> tuple[Any, Any, Any, Any]:
        try:
            from ifxradarsdk import get_version_full
            from ifxradarsdk.fmcw import DeviceFmcw
            from ifxradarsdk.fmcw.types import FmcwSequenceChirp, FmcwSimpleSequenceConfig
        except ImportError as error:
            raise InfineonRdkUnavailable(
                "Infineon ifxradarsdk is not installed. Install the Python wheel included "
                "with the Radar Development Kit on the gateway machine."
            ) from error
        return get_version_full, DeviceFmcw, FmcwSimpleSequenceConfig, FmcwSequenceChirp

    def connect(self) -> dict[str, Any]:
        if self._device is not None:
            return self.status()
        get_version_full, DeviceFmcw, _, _ = self._load_sdk()
        self._device = DeviceFmcw(uuid=self._board_uuid) if self._board_uuid else DeviceFmcw()
        self._sdk_version = str(get_version_full())
        self._board_uuid = str(self._device.get_board_uuid())
        self.configure(self._config)
        return self.status()

    def configure(self, config: FmcwConfig) -> dict[str, Any]:
        config.validate()
        if self._device is None:
            self.connect()
        _, _, FmcwSimpleSequenceConfig, FmcwSequenceChirp = self._load_sdk()
        chirp = FmcwSequenceChirp(
            start_frequency_Hz=config.start_frequency_hz,
            end_frequency_Hz=config.end_frequency_hz,
            sample_rate_Hz=config.sample_rate_hz,
            num_samples=config.samples_per_chirp,
            rx_mask=config.rx_mask,
            tx_mask=config.tx_mask,
            tx_power_level=config.tx_power_level,
            lp_cutoff_Hz=config.low_pass_cutoff_hz,
            hp_cutoff_Hz=config.high_pass_cutoff_hz,
            if_gain_dB=config.if_gain_db,
        )
        simple = FmcwSimpleSequenceConfig(
            frame_repetition_time_s=1 / config.frame_rate_hz,
            chirp_repetition_time_s=config.chirp_repetition_time_s,
            num_chirps=config.chirps_per_frame,
            tdm_mimo=False,
            chirp=chirp,
        )
        sequence = self._device.create_simple_sequence(simple)
        self._device.set_acquisition_sequence(sequence)
        self._config = config
        return self.status()

    def read_frame(
        self,
        *,
        session_id: str,
        position: str,
        sequence: int,
    ) -> dict[str, Any]:
        if self._device is None:
            self.connect()
        frame_contents = self._device.get_next_frame()
        if not frame_contents:
            raise RuntimeError("Infineon RDK returned an empty frame.")
        cube = frame_contents[0]
        if len(cube.shape) != 3:
            raise RuntimeError(f"Unexpected radar cube dimensions: {cube.shape!r}")
        channels, chirps, adc_samples = (int(value) for value in cube.shape)
        if adc_samples != self._config.samples_per_chirp:
            raise RuntimeError(
                f"Configured {self._config.samples_per_chirp} ADC samples but received {adc_samples}."
            )

        averaged = cube.mean(axis=1)
        samples: list[float] = []
        for channel in range(channels):
            for sample in range(adc_samples):
                samples.extend((float(averaged[channel, sample]), 0.0))

        frame = frame_metadata(
            config=self._config,
            session_id=session_id,
            position=position,
            sequence=sequence,
            samples=samples,
            channels=channels,
            source=self.source_name,
            simulated=False,
        )
        frame["acquisition"]["rawCubeShape"] = [channels, chirps, adc_samples]
        frame["acquisition"]["chirpReduction"] = "mean"
        return frame

    def status(self) -> dict[str, Any]:
        return {
            "source": self.source_name,
            "deviceConnected": self._device is not None,
            "boardUuid": self._board_uuid,
            "sdkVersion": self._sdk_version,
            "config": self._config.public_dict(),
        }

    def close(self) -> None:
        device = self._device
        self._device = None
        if device is not None:
            close = getattr(device, "close", None)
            if callable(close):
                close()
