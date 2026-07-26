from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from typing import Any

from .aggregate import MultiLinkWifiCsiSource
from .digital_bench import DigitalBenchCsi0Source, digital_bench_scenario
from .source import WifiGatewayConfig


@dataclass(frozen=True, slots=True)
class BenchCheck:
    id: str
    passed: bool
    detail: str
    metrics: dict[str, Any]


@dataclass(frozen=True, slots=True)
class BenchReadinessReport:
    version: str
    passed: bool
    checks: tuple[BenchCheck, ...]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _config(session_id: str) -> WifiGatewayConfig:
    return WifiGatewayConfig(
        session_id=session_id,
        tx_node_id="tx-digital-bench",
        rx_node_id="rx-1",
        clock_domain="digital-bench-clock",
        band="5-ghz",
        channel=36,
        center_frequency_hz=5_180_000_000,
        bandwidth_hz=20_000_000,
        phy="ht",
        frame_rate_hz=20,
        subcarrier_indices=tuple(list(range(-28, 0)) + list(range(1, 29))),
    )


def _source(name: str, receiver_count: int = 3) -> MultiLinkWifiCsiSource:
    scenario = digital_bench_scenario(name, receiver_count)
    return MultiLinkWifiCsiSource(
        [
            (f"rx-{index + 1}", DigitalBenchCsi0Source(index, scenario))
            for index in range(receiver_count)
        ]
    )


def _capture(name: str, soundings: int, receiver_count: int = 3) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source = _source(name, receiver_count)
    try:
        source.connect()
        source.configure(_config(f"readiness-{name}"))
        frames = [source.read_frame() for _ in range(soundings * receiver_count)]
        return frames, source.status()
    finally:
        source.close()


def _expect_failure(
    name: str,
    maximum_soundings: int,
    expected_text: str,
    receiver_count: int = 3,
) -> BenchCheck:
    source = _source(name, receiver_count)
    observed: Exception | None = None
    try:
        source.connect()
        source.configure(_config(f"readiness-{name}"))
        for _ in range(maximum_soundings * receiver_count):
            source.read_frame()
    except Exception as error:  # the failure is the expected result of this check
        observed = error
    finally:
        source.close()
    passed = observed is not None and expected_text.lower() in str(observed).lower()
    return BenchCheck(
        id=name,
        passed=passed,
        detail=(
            f"Expected rejection observed: {observed}"
            if passed
            else f"Expected rejection containing {expected_text!r}; observed {observed!r}."
        ),
        metrics={"expectedError": expected_text, "observedError": str(observed) if observed else None},
    )


def run_pre_hardware_readiness() -> BenchReadinessReport:
    checks: list[BenchCheck] = []

    healthy_frames, healthy_status = _capture("healthy", 36)
    healthy_soundings = {frame["soundingSequence"] for frame in healthy_frames}
    healthy_explicit = all(
        frame.get("soundingIdSource") == "transmitter-payload"
        and frame.get("csi0Version") == 2
        for frame in healthy_frames
    )
    checks.append(
        BenchCheck(
            id="healthy-wire-pipeline",
            passed=(
                len(healthy_soundings) == 36
                and healthy_explicit
                and healthy_status["explicitSoundingBatches"] == 36
                and healthy_status["fallbackSoundingBatches"] == 0
            ),
            detail="CSI0 v2 UART fragmentation, exact multi-link join and WCS1 output completed.",
            metrics={
                "soundings": len(healthy_soundings),
                "frames": len(healthy_frames),
                "explicitBatches": healthy_status["explicitSoundingBatches"],
                "fallbackBatches": healthy_status["fallbackSoundingBatches"],
            },
        )
    )

    offset_frames, offset_status = _capture("start-offsets", 6)
    first_offset_id = min(frame["soundingSequence"] for frame in offset_frames)
    checks.append(
        BenchCheck(
            id="independent-receiver-start",
            passed=first_offset_id == 6 and offset_status["fallbackSoundingBatches"] == 0,
            detail="Receivers with different initial offsets were joined only on common transmitter IDs.",
            metrics={
                "firstCommonSoundingId": first_offset_id,
                "discardedUnpairedFrames": offset_status["discardedUnpairedFrames"],
            },
        )
    )

    lossy_frames, lossy_status = _capture("lossy", 24)
    lossy_ids = sorted({frame["soundingSequence"] for frame in lossy_frames})
    checks.append(
        BenchCheck(
            id="packet-loss-alignment",
            passed=(
                5 not in lossy_ids
                and 6 not in lossy_ids
                and lossy_status["transmitterSoundingGaps"] >= 2
            ),
            detail="Missing receiver packets created explicit gaps and never false cross-packet pairs.",
            metrics={
                "capturedIds": lossy_ids,
                "transmitterSoundingGaps": lossy_status["transmitterSoundingGaps"],
                "discardedUnpairedFrames": lossy_status["discardedUnpairedFrames"],
            },
        )
    )

    queue_frames, queue_status = _capture("queue-drop", 58)
    queue_flagged = any(
        "receiver-queue-drops" in frame.get("qualityFlags", []) for frame in queue_frames
    )
    checks.append(
        BenchCheck(
            id="receiver-queue-drop-detection",
            passed=queue_flagged
            and any(
                int(child.get("receiverDroppedRecordCount") or 0) > 0
                for child in queue_status.get("childSources", [])
            ),
            detail="Cumulative receiver queue loss propagated through CSI0, WCS1 and gateway status.",
            metrics={
                "flaggedFrames": sum(
                    "receiver-queue-drops" in frame.get("qualityFlags", [])
                    for frame in queue_frames
                ),
                "childSources": queue_status.get("childSources", []),
            },
        )
    )

    checks.append(_expect_failure("identity-fallback", 45, "fallback sounding identities"))
    checks.append(_expect_failure("nonce-change", 84, "session nonce changed"))
    checks.append(_expect_failure("truncated-payload", 48, "cannot be mapped safely"))

    return BenchReadinessReport(
        version="wifi-pre-hardware-readiness-v1",
        passed=all(check.passed for check in checks),
        checks=tuple(checks),
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run ScanIt Wi-Fi CSI pre-hardware transport and failure-injection checks."
    )
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    args = parser.parse_args()
    report = run_pre_hardware_readiness()
    if args.json:
        print(json.dumps(report.to_dict(), indent=2, sort_keys=True))
    else:
        print(f"Wi-Fi pre-hardware readiness: {'PASS' if report.passed else 'FAIL'}")
        for check in report.checks:
            print(f"[{'PASS' if check.passed else 'FAIL'}] {check.id}: {check.detail}")
    raise SystemExit(0 if report.passed else 1)


if __name__ == "__main__":
    main()
