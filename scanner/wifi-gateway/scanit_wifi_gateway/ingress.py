from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Any

CSI0_MAGIC = 0x30495343
CSI0_VERSION = 1
CSI0_HEADER = struct.Struct("<IHHIq6sbbBBBBBBH")


class CsiIngressError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class Csi0Record:
    sequence: int
    monotonic_timestamp_us: int
    source_mac: str
    rssi_dbm: int
    noise_floor_dbm: int
    channel: int
    secondary_channel: int
    antenna: int
    mcs: int
    bandwidth_40mhz: bool
    first_word_invalid: bool
    payload: bytes


@dataclass(frozen=True, slots=True)
class WifiFrameMapping:
    session_id: str
    tx_node_id: str
    rx_node_id: str
    clock_domain: str
    band: str
    center_frequency_hz: int
    bandwidth_hz: int
    phy: str
    spatial_stream: int
    subcarrier_indices: tuple[int, ...]
    tx_antenna: int = 0
    firmware_version: str = "scanit-esp32-wifi-csi-v1"
    source: str = "esp32-csi0"
    timestamp_uncertainty_ns: int = 500_000


class Csi0StreamParser:
    def __init__(self) -> None:
        self._buffer = bytearray()

    def feed(self, data: bytes) -> list[Csi0Record]:
        self._buffer.extend(data)
        records: list[Csi0Record] = []
        while True:
            if len(self._buffer) < CSI0_HEADER.size:
                break
            values = CSI0_HEADER.unpack_from(self._buffer, 0)
            (
                magic,
                version,
                header_bytes,
                sequence,
                monotonic_timestamp_us,
                source_mac,
                rssi_dbm,
                noise_floor_dbm,
                channel,
                secondary_channel,
                antenna,
                mcs,
                bandwidth_40mhz,
                first_word_invalid,
                payload_bytes,
            ) = values
            if magic != CSI0_MAGIC:
                raise CsiIngressError("Invalid CSI0 magic value.")
            if version != CSI0_VERSION:
                raise CsiIngressError(f"Unsupported CSI0 version {version}.")
            if header_bytes != CSI0_HEADER.size:
                raise CsiIngressError(
                    f"CSI0 header size {header_bytes} does not match {CSI0_HEADER.size}."
                )
            if payload_bytes <= 0 or payload_bytes > 512:
                raise CsiIngressError("CSI0 payload size is outside the allowed range.")
            record_size = header_bytes + payload_bytes
            if len(self._buffer) < record_size:
                break
            payload = bytes(self._buffer[header_bytes:record_size])
            del self._buffer[:record_size]
            records.append(
                Csi0Record(
                    sequence=sequence,
                    monotonic_timestamp_us=monotonic_timestamp_us,
                    source_mac=source_mac.hex(":"),
                    rssi_dbm=rssi_dbm,
                    noise_floor_dbm=noise_floor_dbm,
                    channel=channel,
                    secondary_channel=secondary_channel,
                    antenna=antenna,
                    mcs=mcs,
                    bandwidth_40mhz=bool(bandwidth_40mhz),
                    first_word_invalid=bool(first_word_invalid),
                    payload=payload,
                )
            )
        return records


def _signed_byte(value: int) -> int:
    return value - 256 if value > 127 else value


def record_to_wcs1_frame(record: Csi0Record, mapping: WifiFrameMapping) -> dict[str, Any]:
    payload = record.payload[4:] if record.first_word_invalid else record.payload
    if len(payload) % 2:
        raise CsiIngressError("CSI0 payload must contain int8 imaginary/real pairs.")
    complex_count = len(payload) // 2
    if complex_count != len(mapping.subcarrier_indices):
        raise CsiIngressError(
            "CSI0 payload cannot be mapped safely: configured subcarrier count "
            f"{len(mapping.subcarrier_indices)} differs from {complex_count}."
        )
    csi: list[float] = []
    for offset in range(0, len(payload), 2):
        imaginary = float(_signed_byte(payload[offset]))
        real = float(_signed_byte(payload[offset + 1]))
        csi.extend((real, imaginary))
    monotonic_ns = record.monotonic_timestamp_us * 1_000
    return {
        "schemaVersion": 1,
        "frameId": f"{mapping.session_id}-{mapping.rx_node_id}-{record.sequence}",
        "sessionId": mapping.session_id,
        "sequence": record.sequence,
        "soundingSequence": record.sequence,
        "timestampNs": str(monotonic_ns),
        "timing": {
            "clockDomain": mapping.clock_domain,
            "timestampSource": "wifi-node-monotonic",
            "monotonicTimestampNs": str(monotonic_ns),
            "uncertaintyNs": mapping.timestamp_uncertainty_ns,
        },
        "txNodeId": mapping.tx_node_id,
        "rxNodeId": mapping.rx_node_id,
        "txAntenna": mapping.tx_antenna,
        "rxAntenna": record.antenna,
        "band": mapping.band,
        "channel": record.channel,
        "centerFrequencyHz": mapping.center_frequency_hz,
        "bandwidthHz": mapping.bandwidth_hz,
        "phy": mapping.phy,
        "spatialStream": mapping.spatial_stream,
        "subcarrierIndices": list(mapping.subcarrier_indices),
        "csi": csi,
        "rssiDbm": record.rssi_dbm,
        "noiseFloorDbm": record.noise_floor_dbm,
        "packetSequence": record.sequence,
        "transmitterMac": record.source_mac,
        "firmwareVersion": mapping.firmware_version,
        "source": mapping.source,
        "qualityFlags": [],
        "isSimulated": False,
    }