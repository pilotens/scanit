from __future__ import annotations

import json
import struct
import sys
import zlib
from array import array
from collections.abc import Mapping, Sequence
from typing import Any

MAGIC = b"WCS1"
VERSION = 1
PREFIX = struct.Struct("<4sHHI")
CHECKSUM = struct.Struct("<I")
FLOAT_SIZE = 4


class WifiProtocolError(ValueError):
    pass


def _float_payload(values: Sequence[float]) -> bytes:
    payload = array("f", (float(value) for value in values))
    if sys.byteorder != "little":
        payload.byteswap()
    return payload.tobytes()


def encode_frame(frame: Mapping[str, Any]) -> bytes:
    csi = frame.get("csi")
    subcarriers = frame.get("subcarrierIndices")
    if not isinstance(csi, Sequence) or not isinstance(subcarriers, Sequence):
        raise WifiProtocolError("WCS1 frame requires CSI and subcarrier arrays.")
    expected = len(subcarriers) * 2
    if not subcarriers or len(csi) != expected:
        raise WifiProtocolError(f"Invalid CSI dimensions. Expected {expected}, received {len(csi)}.")

    header = {key: value for key, value in frame.items() if key != "csi"}
    header["complexValueCount"] = len(csi)
    header_bytes = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(header_bytes) > 0xFFFF:
        raise WifiProtocolError("WCS1 metadata exceeds the header limit.")
    payload = _float_payload(csi)
    prefix = PREFIX.pack(MAGIC, VERSION, len(header_bytes), len(payload))
    body = prefix + header_bytes + payload
    return body + CHECKSUM.pack(zlib.crc32(body) & 0xFFFFFFFF)


def decode_frame(packet: bytes) -> dict[str, Any]:
    if len(packet) < PREFIX.size + CHECKSUM.size:
        raise WifiProtocolError("WCS1 packet is too short.")
    magic, version, header_length, payload_length = PREFIX.unpack_from(packet, 0)
    if magic != MAGIC:
        raise WifiProtocolError("Invalid WCS1 magic value.")
    if version != VERSION:
        raise WifiProtocolError(f"Unsupported WCS1 version {version}.")
    checksum_offset = PREFIX.size + header_length + payload_length
    if checksum_offset + CHECKSUM.size != len(packet):
        raise WifiProtocolError("WCS1 packet length does not match its header.")
    expected_crc = CHECKSUM.unpack_from(packet, checksum_offset)[0]
    actual_crc = zlib.crc32(packet[:checksum_offset]) & 0xFFFFFFFF
    if expected_crc != actual_crc:
        raise WifiProtocolError("WCS1 CRC verification failed.")

    header_start = PREFIX.size
    header_end = header_start + header_length
    header = json.loads(packet[header_start:header_end].decode("utf-8"))
    value_count = int(header.pop("complexValueCount", 0))
    if value_count * FLOAT_SIZE != payload_length:
        raise WifiProtocolError("WCS1 value count is inconsistent.")
    if value_count != len(header.get("subcarrierIndices", [])) * 2:
        raise WifiProtocolError("WCS1 subcarrier dimensions are inconsistent.")
    values = array("f")
    values.frombytes(packet[header_end:checksum_offset])
    if sys.byteorder != "little":
        values.byteswap()
    header["csi"] = [float(value) for value in values]
    return header