from __future__ import annotations

import json
import struct
import sys
import zlib
from array import array
from collections.abc import Mapping, Sequence
from typing import Any

MAGIC = b"SCN1"
VERSION = 1
PREFIX = struct.Struct("<4sHHI")
CHECKSUM = struct.Struct("<I")
FLOAT_SIZE = 4


class ProtocolError(ValueError):
    """Raised when an SCN1 packet is malformed or fails integrity checks."""


def _float_payload(samples: Sequence[float]) -> bytes:
    values = array("f", (float(value) for value in samples))
    if sys.byteorder != "little":
        values.byteswap()
    return values.tobytes()


def encode_frame(frame: Mapping[str, Any]) -> bytes:
    samples = frame.get("samples")
    if not isinstance(samples, Sequence):
        raise ProtocolError("Frame samples must be a sequence.")

    channels = int(frame.get("channels", 0))
    samples_per_channel = int(frame.get("samplesPerChannel", 0))
    expected = channels * samples_per_channel * 2
    if expected <= 0 or len(samples) != expected:
        raise ProtocolError(
            f"Invalid sample length. Expected {expected}, received {len(samples)}."
        )

    header = {key: value for key, value in frame.items() if key != "samples"}
    header["sampleCount"] = len(samples)
    header_bytes = json.dumps(
        header,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(header_bytes) > 0xFFFF:
        raise ProtocolError("Frame metadata exceeds the SCN1 header limit.")

    payload = _float_payload(samples)
    prefix = PREFIX.pack(MAGIC, VERSION, len(header_bytes), len(payload))
    body = prefix + header_bytes + payload
    return body + CHECKSUM.pack(zlib.crc32(body) & 0xFFFFFFFF)


def decode_frame(packet: bytes) -> dict[str, Any]:
    if len(packet) < PREFIX.size + CHECKSUM.size:
        raise ProtocolError("Scanner packet is too short.")

    magic, version, header_length, payload_length = PREFIX.unpack_from(packet, 0)
    if magic != MAGIC:
        raise ProtocolError("Scanner packet has an invalid magic value.")
    if version != VERSION:
        raise ProtocolError(f"Unsupported scanner packet version {version}.")

    checksum_offset = PREFIX.size + header_length + payload_length
    if checksum_offset + CHECKSUM.size != len(packet):
        raise ProtocolError("Scanner packet length does not match its header.")

    expected_crc = CHECKSUM.unpack_from(packet, checksum_offset)[0]
    actual_crc = zlib.crc32(packet[:checksum_offset]) & 0xFFFFFFFF
    if expected_crc != actual_crc:
        raise ProtocolError("Scanner packet CRC verification failed.")

    header_start = PREFIX.size
    header_end = header_start + header_length
    header = json.loads(packet[header_start:header_end].decode("utf-8"))
    sample_count = int(header.pop("sampleCount", 0))
    if sample_count * FLOAT_SIZE != payload_length:
        raise ProtocolError("Scanner packet sample count is inconsistent.")

    values = array("f")
    values.frombytes(packet[header_end:checksum_offset])
    if sys.byteorder != "little":
        values.byteswap()
    header["samples"] = [float(value) for value in values]
    return header
