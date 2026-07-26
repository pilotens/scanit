from __future__ import annotations

import time
import uuid
from typing import Any

_CLOCK_DOMAIN = f"scanit-gateway-{uuid.uuid4()}"
_BOOT_MONOTONIC_NS = time.perf_counter_ns()
_BOOT_WALL_CLOCK_NS = time.time_ns()


def monotonic_now_ns() -> int:
    return time.perf_counter_ns()


def wall_clock_from_monotonic_ns(monotonic_ns: int) -> int:
    return _BOOT_WALL_CLOCK_NS + (monotonic_ns - _BOOT_MONOTONIC_NS)


def build_frame_timing(
    acquisition_started_monotonic_ns: int,
    acquisition_ended_monotonic_ns: int,
    *,
    source: str = "gateway-monotonic-midpoint",
    minimum_uncertainty_ns: int = 100_000,
) -> dict[str, Any]:
    if acquisition_ended_monotonic_ns < acquisition_started_monotonic_ns:
        raise ValueError("Acquisition end precedes acquisition start.")
    midpoint = (
        acquisition_started_monotonic_ns + acquisition_ended_monotonic_ns
    ) // 2
    half_duration = (
        acquisition_ended_monotonic_ns - acquisition_started_monotonic_ns
    ) // 2
    uncertainty_ns = max(minimum_uncertainty_ns, half_duration)
    return {
        "clockDomain": _CLOCK_DOMAIN,
        "timestampSource": source,
        "monotonicTimestampNs": str(midpoint),
        "wallClockUnixNs": str(wall_clock_from_monotonic_ns(midpoint)),
        "uncertaintyNs": uncertainty_ns,
        "acquisitionStartedMonotonicNs": str(acquisition_started_monotonic_ns),
        "acquisitionEndedMonotonicNs": str(acquisition_ended_monotonic_ns),
        "anchorMonotonicNs": str(_BOOT_MONOTONIC_NS),
        "anchorWallClockUnixNs": str(_BOOT_WALL_CLOCK_NS),
    }


def clock_status() -> dict[str, Any]:
    return {
        "clockDomain": _CLOCK_DOMAIN,
        "timestampSource": "gateway-monotonic-midpoint",
        "anchorMonotonicNs": str(_BOOT_MONOTONIC_NS),
        "anchorWallClockUnixNs": str(_BOOT_WALL_CLOCK_NS),
    }
