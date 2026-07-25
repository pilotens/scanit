from __future__ import annotations

import math
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, replace
from typing import Any

from .ingress import Csi0StreamParser, WifiFrameMapping, record_to_wcs1_frame


@dataclass(frozen=True, slots=True)
class WifiGatewayConfig:
    session_id: str = "wifi-session"
    tx_node_id: str = "tx-node"
    rx_node_id: str = "rx-node"
    clock_domain: str = "wifi-node-clock"
    band: str = "5-ghz"
    channel: int = 36
    center_frequency_hz: int = 5_180_000_000
    bandwidth_hz: int = 20_000_000
    phy: str = "he"
    spatial_stream: int = 0
    tx_antenna: int = 0
    frame_rate_hz: float = 20.0
    subcarrier_indices: tuple[int, ...] = tuple(
        list(range(-28, 0)) + list(range(1, 29))
    )

    def apply_payload(self, payload: dict[str, Any]) -> "WifiGatewayConfig":
        aliases = {
            "sessionId": "session_id",
            "txNodeId": "tx_node_id",
            "rxNodeId": "rx_node_id",
            "clockDomain": "clock_domain",
            "centerFrequencyHz": "center_frequency_hz",
            "bandwidthHz": "bandwidth_hz",
            "spatialStream": "spatial_stream",
            "txAntenna": "tx_antenna",
            "frameRateHz": "frame_rate_hz",
            "subcarrierIndices": "subcarrier_indices",
        }
        changes: dict[str, Any] = {}
        for key, value in payload.items():
            normalized = aliases.get(key, key)
            if normalized == "subcarrier_indices":
                changes[normalized] = tuple(int(item) for item in value)
            elif normalized in self.__dataclass_fields__:
                changes[normalized] = value
        updated = replace(self, **changes)
        updated.validate()
        return updated

    def validate(self) -> None:
        if not self.session_id or not self.tx_node_id or not self.rx_node_id:
            raise ValueError("Session, TX node and RX node identifiers are required.")
        if self.frame_rate_hz <= 0 or self.frame_rate_hz > 100:
            raise ValueError("frame_rate_hz must be between 1 and 100.")
        if self.bandwidth_hz not in {20_000_000, 40_000_000, 80_000_000, 160_000_000, 320_000_000}:
            raise ValueError("Unsupported Wi-Fi channel bandwidth.")
        if not self.subcarrier_indices or len(set(self.subcarrier_indices)) != len(self.subcarrier_indices):
            raise ValueError("An explicit unique subcarrier map is required.")

    def mapping(self) -> WifiFrameMapping:
        return WifiFrameMapping(
            session_id=self.session_id,
            tx_node_id=self.tx_node_id,
            rx_node_id=self.rx_node_id,
            clock_domain=self.clock_domain,
            band=self.band,
            center_frequency_hz=self.center_frequency_hz,
            bandwidth_hz=self.bandwidth_hz,
            phy=self.phy,
            spatial_stream=self.spatial_stream,
            subcarrier_indices=self.subcarrier_indices,
            tx_antenna=self.tx_antenna,
        )

    def public_dict(self) -> dict[str, Any]:
        return {
            "sessionId": self.session_id,
            "txNodeId": self.tx_node_id,
            "rxNodeId": self.rx_node_id,
            "clockDomain": self.clock_domain,
            "band": self.band,
            "channel": self.channel,
            "centerFrequencyHz": self.center_frequency_hz,
            "bandwidthHz": self.bandwidth_hz,
            "phy": self.phy,
            "spatialStream": self.spatial_stream,
            "txAntenna": self.tx_antenna,
            "frameRateHz": self.frame_rate_hz,
            "subcarrierIndices": list(self.subcarrier_indices),
        }


class WifiCsiSource(ABC):
    source_name: str

    @abstractmethod
    def connect(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def configure(self, config: WifiGatewayConfig) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def read_frame(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def status(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def close(self) -> None:
        raise NotImplementedError


class FakeWifiCsiSource(WifiCsiSource):
    source_name = "deterministic-wifi-csi-fake"

    def __init__(self) -> None:
        self._connected = False
        self._config = WifiGatewayConfig()
        self._sequence = 0
        self._started_ns = 2_100_000_000_000_000_000

    def connect(self) -> dict[str, Any]:
        self._connected = True
        return self.status()

    def configure(self, config: WifiGatewayConfig) -> dict[str, Any]:
        config.validate()
        self._config = config
        return self.status()

    def read_frame(self) -> dict[str, Any]:
        if not self._connected:
            self.connect()
        sequence = self._sequence
        self._sequence += 1
        time.sleep(min(1 / self._config.frame_rate_hz, 0.01))
        elapsed = sequence / self._config.frame_rate_hz
        respiration = 0.3 * math.sin(2 * math.pi * 0.24 * elapsed)
        mechanical = 0.06 * math.sin(2 * math.pi * 1.18 * elapsed)
        csi: list[float] = []
        for subcarrier in self._config.subcarrier_indices:
            phase = 0.6 + subcarrier * 0.022 + respiration + mechanical
            magnitude = 0.9 + 0.03 * math.sin(subcarrier * 0.17)
            csi.extend((magnitude * math.cos(phase), magnitude * math.sin(phase)))
        timestamp_ns = self._started_ns + int(sequence * 1_000_000_000 / self._config.frame_rate_hz)
        return {
            "schemaVersion": 1,
            "frameId": f"{self._config.session_id}-{self._config.rx_node_id}-{sequence}",
            "sessionId": self._config.session_id,
            "sequence": sequence,
            "soundingSequence": sequence,
            "timestampNs": str(timestamp_ns),
            "timing": {
                "clockDomain": self._config.clock_domain,
                "timestampSource": "wifi-node-monotonic",
                "monotonicTimestampNs": str(timestamp_ns),
                "uncertaintyNs": 150_000,
            },
            "txNodeId": self._config.tx_node_id,
            "rxNodeId": self._config.rx_node_id,
            "txAntenna": self._config.tx_antenna,
            "rxAntenna": 0,
            "band": self._config.band,
            "channel": self._config.channel,
            "centerFrequencyHz": self._config.center_frequency_hz,
            "bandwidthHz": self._config.bandwidth_hz,
            "phy": self._config.phy,
            "spatialStream": self._config.spatial_stream,
            "subcarrierIndices": list(self._config.subcarrier_indices),
            "csi": csi,
            "rssiDbm": -43,
            "noiseFloorDbm": -94,
            "packetSequence": sequence,
            "firmwareVersion": "fake-wifi-csi-v1",
            "source": self.source_name,
            "qualityFlags": [],
            "isSimulated": True,
        }

    def status(self) -> dict[str, Any]:
        return {
            "source": self.source_name,
            "deviceConnected": self._connected,
            "supportsRawCsi": True,
            "explicitSubcarrierMap": True,
            "config": self._config.public_dict(),
        }

    def close(self) -> None:
        self._connected = False


class SerialWifiCsiSource(WifiCsiSource):
    source_name = "esp32-csi0-serial"

    def __init__(self, port: str, baudrate: int = 2_000_000) -> None:
        self._port = port
        self._baudrate = baudrate
        self._serial: Any | None = None
        self._parser = Csi0StreamParser()
        self._pending: list[dict[str, Any]] = []
        self._config = WifiGatewayConfig(rx_node_id=port.replace("/", "-"))

    def connect(self) -> dict[str, Any]:
        if self._serial is None:
            import serial

            self._serial = serial.Serial(self._port, self._baudrate, timeout=1)
        return self.status()

    def configure(self, config: WifiGatewayConfig) -> dict[str, Any]:
        config.validate()
        self._config = config
        return self.status()

    def read_frame(self) -> dict[str, Any]:
        if self._serial is None:
            self.connect()
        while not self._pending:
            chunk = self._serial.read(4096)
            if not chunk:
                raise TimeoutError("Timed out waiting for CSI0 data from the ESP32 node.")
            records = self._parser.feed(chunk)
            self._pending.extend(
                record_to_wcs1_frame(record, self._config.mapping()) for record in records
            )
        return self._pending.pop(0)

    def status(self) -> dict[str, Any]:
        return {
            "source": self.source_name,
            "deviceConnected": self._serial is not None and bool(self._serial.is_open),
            "serialPort": self._port,
            "baudrate": self._baudrate,
            "supportsRawCsi": True,
            "explicitSubcarrierMap": bool(self._config.subcarrier_indices),
            "config": self._config.public_dict(),
        }

    def close(self) -> None:
        serial_port = self._serial
        self._serial = None
        if serial_port is not None:
            serial_port.close()