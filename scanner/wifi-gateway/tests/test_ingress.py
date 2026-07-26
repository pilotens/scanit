from __future__ import annotations

import unittest

from scanit_wifi_gateway.ingress import (
    CSI0_HEADER_V1,
    CSI0_HEADER_V2,
    CSI0_MAGIC,
    CSI0_VERSION_V1,
    CSI0_VERSION_V2,
    CSI_STATUS_QUEUE_DROPS_PRESENT,
    CSI_STATUS_SOUNDING_CRC_VALID,
    CSI_STATUS_SOUNDING_ID_PRESENT,
    CSI_STATUS_TIMESTAMP_MATCHED,
    Csi0StreamParser,
    CsiIngressError,
    WifiFrameMapping,
    record_to_wcs1_frame,
)


def v1_record_bytes(payload: bytes, *, first_word_invalid: bool = False) -> bytes:
    header = CSI0_HEADER_V1.pack(
        CSI0_MAGIC,
        CSI0_VERSION_V1,
        CSI0_HEADER_V1.size,
        17,
        12_345_678,
        bytes.fromhex("001122334455"),
        -48,
        -95,
        36,
        0,
        1,
        3,
        0,
        1 if first_word_invalid else 0,
        len(payload),
    )
    return header + payload


def v2_record_bytes(
    payload: bytes,
    *,
    sounding_id: int = 1234,
    nonce: int = 0x5343414E,
    marker_delta_us: int = 22,
    status_flags: int = (
        CSI_STATUS_SOUNDING_ID_PRESENT
        | CSI_STATUS_SOUNDING_CRC_VALID
        | CSI_STATUS_TIMESTAMP_MATCHED
    ),
    dropped_total: int = 0,
    first_word_invalid: bool = False,
) -> bytes:
    header = CSI0_HEADER_V2.pack(
        CSI0_MAGIC,
        CSI0_VERSION_V2,
        CSI0_HEADER_V2.size,
        17,
        sounding_id,
        nonce,
        12_345_678,
        11_000_000,
        9_876_543,
        marker_delta_us,
        bytes.fromhex("001122334455"),
        -48,
        -95,
        36,
        0,
        1,
        3,
        0,
        1 if first_word_invalid else 0,
        status_flags,
        dropped_total,
        len(payload),
    )
    return header + payload


def mapping() -> WifiFrameMapping:
    return WifiFrameMapping(
        session_id="test",
        tx_node_id="tx",
        rx_node_id="rx-left",
        clock_domain="node-clock",
        band="5-ghz",
        center_frequency_hz=5_180_000_000,
        bandwidth_hz=20_000_000,
        phy="he",
        spatial_stream=0,
        subcarrier_indices=(-2, -1, 1, 2),
    )


class CsiIngressTests(unittest.TestCase):
    def test_stream_parser_handles_split_v2_records(self) -> None:
        payload = bytes([1, 10, 2, 20, 3, 30, 4, 40])
        packet = v2_record_bytes(payload)
        parser = Csi0StreamParser()

        first = parser.feed(packet[:19])
        second = parser.feed(packet[19:])

        self.assertEqual(first, [])
        self.assertEqual(len(second), 1)
        record = second[0]
        self.assertEqual(record.version, 2)
        self.assertEqual(record.sequence, 17)
        self.assertEqual(record.sounding_id, 1234)
        self.assertEqual(record.sounding_session_nonce, 0x5343414E)
        self.assertTrue(record.has_explicit_sounding_id)
        self.assertEqual(record.marker_delta_us, 22)
        self.assertEqual(record.source_mac, "00:11:22:33:44:55")
        self.assertEqual(record.payload, payload)
        self.assertEqual(parser.v2_records_decoded, 1)

    def test_maps_explicit_sounding_identity_to_wcs1(self) -> None:
        payload = bytes([1, 10, 254, 20, 3, 226, 252, 40])
        record = Csi0StreamParser().feed(v2_record_bytes(payload))[0]

        frame = record_to_wcs1_frame(record, mapping())

        self.assertEqual(frame["csi"], [10.0, 1.0, 20.0, -2.0, -30.0, 3.0, 40.0, -4.0])
        self.assertEqual(frame["soundingSequence"], 1234)
        self.assertEqual(frame["soundingSessionNonce"], 0x5343414E)
        self.assertEqual(frame["soundingIdSource"], "transmitter-payload")
        self.assertEqual(frame["soundingMarkerDeltaMicroseconds"], 22)
        self.assertEqual(frame["timing"]["clockDomain"], "node-clock")
        self.assertEqual(frame["timing"]["uncertaintyNs"], 522_000)
        self.assertFalse(frame["isSimulated"])
        self.assertNotIn("missing-explicit-sounding-id", frame["qualityFlags"])

    def test_preserves_v1_as_explicitly_flagged_fallback(self) -> None:
        payload = bytes([1, 10, 2, 20, 3, 30, 4, 40])
        record = Csi0StreamParser().feed(v1_record_bytes(payload))[0]
        frame = record_to_wcs1_frame(record, mapping())

        self.assertEqual(frame["soundingSequence"], 17)
        self.assertEqual(frame["soundingIdSource"], "receiver-sequence-fallback")
        self.assertIn("legacy-csi0-v1", frame["qualityFlags"])
        self.assertIn("missing-explicit-sounding-id", frame["qualityFlags"])

    def test_propagates_receiver_queue_drops(self) -> None:
        payload = bytes([1, 10, 2, 20, 3, 30, 4, 40])
        status = (
            CSI_STATUS_SOUNDING_ID_PRESENT
            | CSI_STATUS_SOUNDING_CRC_VALID
            | CSI_STATUS_TIMESTAMP_MATCHED
            | CSI_STATUS_QUEUE_DROPS_PRESENT
        )
        record = Csi0StreamParser().feed(
            v2_record_bytes(payload, status_flags=status, dropped_total=3)
        )[0]
        frame = record_to_wcs1_frame(record, mapping())

        self.assertEqual(frame["receiverDroppedRecordCount"], 3)
        self.assertIn("receiver-queue-drops", frame["qualityFlags"])

    def test_rejects_unknown_subcarrier_dimensions(self) -> None:
        payload = bytes([1, 10, 2, 20])
        record = Csi0StreamParser().feed(v2_record_bytes(payload))[0]
        bad_mapping = WifiFrameMapping(
            session_id="test",
            tx_node_id="tx",
            rx_node_id="rx",
            clock_domain="clock",
            band="5-ghz",
            center_frequency_hz=5_180_000_000,
            bandwidth_hz=20_000_000,
            phy="he",
            spatial_stream=0,
            subcarrier_indices=(-2, -1, 1),
        )

        with self.assertRaisesRegex(CsiIngressError, "cannot be mapped safely"):
            record_to_wcs1_frame(record, bad_mapping)


if __name__ == "__main__":
    unittest.main()
