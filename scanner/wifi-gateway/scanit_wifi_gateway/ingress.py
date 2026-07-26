from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Any

CSI0_MAGIC = 0x30495343
CSI0_VERSION_V1 = 1
CSI0_VERSION_V2 = 2
CSI0_COMMON_HEADER = struct.Struct("<IHH")
CSI0_HEADER_V1 = struct.Struct("<IHHIq6sbbBBBBBBH")
CSI0_HEADER_V2 = struct.Struct("<IHHIIIqqIi6sbbBBBBBBHIH")

CSI_STATUS_SOUNDING_ID_PRESENT = 1 << 0
CSI_STATUS_SOUNDING_CRC_VALID = 1 << 1
CSI_STATUS_TIMESTAMP_MATCHED = 1 << 2
CSI_STATUS_PAYLOAD_TRUNCATED = 1 << 3
CSI_STATUS_QUEUE_DROPS_PRESENT = 1 << 4


class CsiIngressError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class Csi0Record:
    version: int
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
    sounding_id: int | None = None
    sounding_session_nonce: int | None = None
    tx_monotonic_timestamp_us: int | None = None
    rx_driver_timestamp_us: int | None = None
    marker_delta_us: int | None = None
    status_flags: int = 0
    dropped_total: int = 0

    @property
    def has_explicit_sounding_id(self) -> bool:
        required = (
            CSI_STATUS_SOUNDING_ID_PRESENT
            | CSI_STATUS_SOUNDING_CRC_VALID
            | CSI_STATUS_TIMESTAMP_MATCHED
        )
        return (
            self.version >= CSI0_VERSION_V2
            and self.sounding_id is not None
            and self.sounding_session_nonce is not None
            and (self.status_flags & required) == required
        )


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
    firmware_version: str = "scanit-esp32-wifi-csi-v2"
    source: str = "esp32-csi0"
    timestamp_uncertainty_ns: int = 500_000


class Csi0StreamParser:
    def __init__(self) -> None:
        self._buffer = bytearray()
        self.records_decoded = 0
        self.v1_records_decoded = 0
        self.v2_records_decoded = 0

    def feed(self, data: bytes) -> list[Csi0Record]:
        self._buffer.extend(data)
        records: list[Csi0Record] = []
        while True:
            if len(self._buffer) < CSI0_COMMON_HEADER.size:
                break
            magic, version, header_bytes = CSI0_COMMON_HEADER.unpack_from(self._buffer, 0)
            if magic != CSI0_MAGIC:
                raise CsiIngressError("Invalid CSI0 magic value.")
            if version == CSI0_VERSION_V1:
                header = CSI0_HEADER_V1
            elif version == CSI0_VERSION_V2:
                header = CSI0_HEADER_V2
            else:
                raise CsiIngressError(f"Unsupported CSI0 version {version}.")
            if header_bytes != header.size:
                raise CsiIngressError(
                    f"CSI0 v{version} header size {header_bytes} does not match {header.size}."
                )
            if len(self._buffer) < header.size:
                break

            values = header.unpack_from(self._buffer, 0)
            if version == CSI0_VERSION_V1:
                (
                    _magic,
                    _version,
                    _header_bytes,
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
                extra: dict[str, Any] = {}
            else:
                (
                    _magic,
                    _version,
                    _header_bytes,
                    sequence,
                    sounding_id,
                    sounding_session_nonce,
                    monotonic_timestamp_us,
                    tx_monotonic_timestamp_us,
                    rx_driver_timestamp_us,
                    marker_delta_us,
                    source_mac,
                    rssi_dbm,
                    noise_floor_dbm,
                    channel,
                    secondary_channel,
                    antenna,
                    mcs,
                    bandwidth_40mhz,
                    first_word_invalid,
                    status_flags,
                    dropped_total,
                    payload_bytes,
                ) = values
                extra = {
                    "sounding_id": None if sounding_id == 0xFFFFFFFF else sounding_id,
                    "sounding_session_nonce": (
                        sounding_session_nonce if sounding_session_nonce else None
                    ),
                    "tx_monotonic_timestamp_us": (
                        tx_monotonic_timestamp_us if tx_monotonic_timestamp_us else None
                    ),
                    "rx_driver_timestamp_us": rx_driver_timestamp_us,
                    "marker_delta_us": (
                        None if marker_delta_us == 0x7FFFFFFF else marker_delta_us
                    ),
                    "status_flags": status_flags,
                    "dropped_total": dropped_total,
                }

            if payload_bytes <= 0 or payload_bytes > 512:
                raise CsiIngressError("CSI0 payload size is outside the allowed range.")
            record_size = header_bytes + payload_bytes
            if len(self._buffer) < record_size:
                break
            payload = bytes(self._buffer[header_bytes:record_size])
            del self._buffer[:record_size]
            record = Csi0Record(
                version=version,
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
                **extra,
            )
            records.append(record)
            self.records_decoded += 1
            if version == CSI0_VERSION_V1:
                self.v1_records_decoded += 1
            else:
                self.v2_records_decoded += 1
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

    explicit = record.has_explicit_sounding_id
    sounding_sequence = record.sounding_id if explicit else record.sequence
    sounding_id_source = "transmitter-payload" if explicit else "receiver-sequence-fallback"
    quality_flags: list[str] = []
    if not explicit:
        quality_flags.append("missing-explicit-sounding-id")
    if record.status_flags & CSI_STATUS_PAYLOAD_TRUNCATED:
        quality_flags.append("csi-payload-truncated")
    if record.status_flags & CSI_STATUS_QUEUE_DROPS_PRESENT or record.dropped_total > 0:
        quality_flags.append("receiver-queue-drops")
    if record.version == CSI0_VERSION_V1:
        quality_flags.append("legacy-csi0-v1")

    monotonic_ns = record.monotonic_timestamp_us * 1_000
    marker_uncertainty_ns = (
        abs(record.marker_delta_us) * 1_000
        if record.marker_delta_us is not None
        else 5_000_000
    )
    timing_uncertainty_ns = mapping.timestamp_uncertainty_ns + marker_uncertainty_ns
    frame: dict[str, Any] = {
        "schemaVersion": 1,
        "frameId": f"{mapping.session_id}-{mapping.rx_node_id}-{record.sequence}",
        "sessionId": mapping.session_id,
        "sequence": record.sequence,
        "soundingSequence": sounding_sequence,
        "soundingIdSource": sounding_id_source,
        "timestampNs": str(monotonic_ns),
        "timing": {
            "clockDomain": mapping.clock_domain,
            "timestampSource": "wifi-node-monotonic",
            "monotonicTimestampNs": str(monotonic_ns),
            "uncertaintyNs": timing_uncertainty_ns,
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
        "qualityFlags": quality_flags,
        "isSimulated": False,
        "csi0Version": record.version,
        "receiverDroppedRecordCount": record.dropped_total,
        "csi0StatusFlags": record.status_flags,
    }
    if record.sounding_session_nonce is not None:
        frame["soundingSessionNonce"] = record.sounding_session_nonce
    if record.tx_monotonic_timestamp_us is not None:
        frame["transmitterTimestampNs"] = str(
            record.tx_monotonic_timestamp_us * 1_000
        )
        frame["transmitterClockDomain"] = f"{mapping.tx_node_id}:local-monotonic"
    if record.rx_driver_timestamp_us is not None:
        frame["receiverDriverTimestampUs"] = record.rx_driver_timestamp_us
    if record.marker_delta_us is not None:
        frame["soundingMarkerDeltaMicroseconds"] = record.marker_delta_us
    return frame
