from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass

SND1_MAGIC = 0x31444E53
SND1_VERSION = 1
IEEE80211_NON_QOS_HEADER_BYTES = 24
SND1_PREFIX = struct.Struct("<IHHIIqHH16s")
SND1_PACKET = struct.Struct("<IHHIIqHH16sI")


class SoundingProtocolError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class SoundingIdentity:
    session_nonce: int
    sounding_id: int
    tx_monotonic_us: int
    channel: int
    sounding_rate_hz: int


def encode_sounding_payload(identity: SoundingIdentity) -> bytes:
    prefix = SND1_PREFIX.pack(
        SND1_MAGIC,
        SND1_VERSION,
        SND1_PACKET.size,
        identity.session_nonce,
        identity.sounding_id,
        identity.tx_monotonic_us,
        identity.channel,
        identity.sounding_rate_hz,
        bytes(16),
    )
    return prefix + struct.pack("<I", zlib.crc32(prefix) & 0xFFFFFFFF)


def decode_sounding_payload(payload: bytes) -> SoundingIdentity:
    if len(payload) != SND1_PACKET.size:
        raise SoundingProtocolError(
            f"SND1 payload length {len(payload)} does not match {SND1_PACKET.size}."
        )
    (
        magic,
        version,
        payload_bytes,
        session_nonce,
        sounding_id,
        tx_monotonic_us,
        channel,
        sounding_rate_hz,
        _reserved,
        expected_crc,
    ) = SND1_PACKET.unpack(payload)
    if magic != SND1_MAGIC:
        raise SoundingProtocolError("Invalid SND1 magic value.")
    if version != SND1_VERSION:
        raise SoundingProtocolError(f"Unsupported SND1 version {version}.")
    if payload_bytes != SND1_PACKET.size:
        raise SoundingProtocolError("SND1 payload size field is inconsistent.")
    actual_crc = zlib.crc32(payload[:-4]) & 0xFFFFFFFF
    if expected_crc != actual_crc:
        raise SoundingProtocolError("SND1 CRC verification failed.")
    return SoundingIdentity(
        session_nonce=session_nonce,
        sounding_id=sounding_id,
        tx_monotonic_us=tx_monotonic_us,
        channel=channel,
        sounding_rate_hz=sounding_rate_hz,
    )


def parse_sounding_data_frame(frame: bytes) -> SoundingIdentity:
    if len(frame) < IEEE80211_NON_QOS_HEADER_BYTES + SND1_PACKET.size:
        raise SoundingProtocolError("IEEE 802.11 sounding frame is too short.")
    frame_control = int.from_bytes(frame[:2], "little")
    if frame_control & 0x00FC != 0x0008:
        raise SoundingProtocolError("Frame is not a non-QoS IEEE 802.11 data frame.")
    start = IEEE80211_NON_QOS_HEADER_BYTES
    return decode_sounding_payload(frame[start : start + SND1_PACKET.size])
