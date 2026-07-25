import type { RawRadioFrame } from '@/domain/radio';
import type {
  ScannerClockAnchor,
  ScannerClockModel,
  ScannerMappedReferenceEvent,
  ScannerReferenceEvent,
} from '@/domain/scannerTiming';

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, value));

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const standardDeviation = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

const anchorsFromFrames = (frames: RawRadioFrame[]): ScannerClockAnchor[] =>
  frames.flatMap((frame) => {
    const timing = frame.timing;
    if (!timing?.wallClockUnixNs) return [];
    return [
      {
        clockDomain: timing.clockDomain,
        monotonicTimestampNs: timing.monotonicTimestampNs || frame.timestampNs,
        wallClockUnixNs: timing.wallClockUnixNs,
        uncertaintyNs: Math.max(0, timing.uncertaintyNs),
      },
    ];
  });

const dominantClockDomain = (anchors: ScannerClockAnchor[]) => {
  const counts = new Map<string, number>();
  for (const anchor of anchors) counts.set(anchor.clockDomain, (counts.get(anchor.clockDomain) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
};

export function buildScannerClockModel(frames: RawRadioFrame[]): ScannerClockModel {
  const allAnchors = anchorsFromFrames(frames);
  const clockDomain = dominantClockDomain(allAnchors);
  const anchors = clockDomain
    ? allAnchors.filter((anchor) => anchor.clockDomain === clockDomain)
    : [];
  const reasons: string[] = [];
  if (anchors.length < 2) {
    return {
      version: 'scanner-clock-model-v1',
      status: 'unavailable',
      clockDomain,
      anchorCount: anchors.length,
      slope: 1,
      driftPpm: 0,
      rmsResidualNs: Number.POSITIVE_INFINITY,
      maximumAnchorUncertaintyNs: anchors[0]?.uncertaintyNs ?? Number.POSITIVE_INFINITY,
      estimatedMappingUncertaintyNs: Number.POSITIVE_INFINITY,
      confidence: 0,
      reasons: ['För få gemensamma monotona och väggklockade tidsankare.'],
    };
  }

  const originMonotonic = BigInt(anchors[0]!.monotonicTimestampNs);
  const originWall = BigInt(anchors[0]!.wallClockUnixNs);
  const wallDeltas = anchors.map((anchor) => Number(BigInt(anchor.wallClockUnixNs) - originWall));
  const monotonicDeltas = anchors.map((anchor) =>
    Number(BigInt(anchor.monotonicTimestampNs) - originMonotonic),
  );
  const wallMean = mean(wallDeltas);
  const monoMean = mean(monotonicDeltas);
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < anchors.length; index += 1) {
    const wall = (wallDeltas[index] ?? 0) - wallMean;
    const mono = (monotonicDeltas[index] ?? 0) - monoMean;
    covariance += wall * mono;
    variance += wall * wall;
  }
  const slope = variance > 0 ? covariance / variance : 1;
  const interceptDelta = monoMean - slope * wallMean;
  const residuals = anchors.map((_, index) =>
    (monotonicDeltas[index] ?? 0) - (interceptDelta + slope * (wallDeltas[index] ?? 0)),
  );
  const rmsResidualNs = Math.sqrt(mean(residuals.map((value) => value ** 2)));
  const maximumAnchorUncertaintyNs = Math.max(...anchors.map(({ uncertaintyNs }) => uncertaintyNs));
  const driftPpm = (slope - 1) * 1_000_000;
  const estimatedMappingUncertaintyNs = Math.sqrt(
    rmsResidualNs ** 2 + maximumAnchorUncertaintyNs ** 2,
  );

  if (Math.abs(driftPpm) > 250) reasons.push('Klockdriften överstiger 250 ppm.');
  if (rmsResidualNs > 5_000_000) reasons.push('Klockmodellens residual överstiger 5 ms.');
  if (maximumAnchorUncertaintyNs > 20_000_000) reasons.push('Tidsankarnas osäkerhet överstiger 20 ms.');
  if (anchors.length < Math.max(4, Math.floor(frames.length * 0.5))) {
    reasons.push('En stor del av frames saknar användbara tidsankare.');
  }

  let status: ScannerClockModel['status'];
  if (
    anchors.length >= 4 &&
    Math.abs(driftPpm) <= 250 &&
    rmsResidualNs <= 5_000_000 &&
    maximumAnchorUncertaintyNs <= 20_000_000
  ) {
    status = 'synchronized';
  } else if (
    anchors.length >= 2 &&
    Math.abs(driftPpm) <= 1_000 &&
    estimatedMappingUncertaintyNs <= 50_000_000
  ) {
    status = 'degraded';
  } else {
    status = 'unavailable';
  }

  const anchorCoverage = anchors.length / Math.max(frames.length, 1);
  const residualScore = clamp(1 - rmsResidualNs / 10_000_000);
  const uncertaintyScore = clamp(1 - maximumAnchorUncertaintyNs / 40_000_000);
  const driftScore = clamp(1 - Math.abs(driftPpm) / 1_000);
  const confidence = clamp(
    anchorCoverage * 0.35 + residualScore * 0.3 + uncertaintyScore * 0.2 + driftScore * 0.15,
  );

  return {
    version: 'scanner-clock-model-v1',
    status,
    clockDomain,
    anchorCount: anchors.length,
    originMonotonicNs: String(originMonotonic + BigInt(Math.round(interceptDelta))),
    originWallClockUnixNs: String(originWall),
    slope,
    driftPpm,
    rmsResidualNs,
    maximumAnchorUncertaintyNs,
    estimatedMappingUncertaintyNs,
    confidence,
    reasons,
  };
}

export function scannerTimestampNs(frame: RawRadioFrame) {
  return BigInt(frame.timing?.monotonicTimestampNs ?? frame.timestampNs);
}

export function mapReferenceEventToScannerClock(
  event: ScannerReferenceEvent,
  model: ScannerClockModel,
): ScannerMappedReferenceEvent | undefined {
  if (
    model.status === 'unavailable' ||
    model.originMonotonicNs === undefined ||
    model.originWallClockUnixNs === undefined
  ) {
    return undefined;
  }
  const wallDelta = Number(
    BigInt(event.timestampUnixNs) - BigInt(model.originWallClockUnixNs),
  );
  if (!Number.isFinite(wallDelta)) return undefined;
  const monotonic =
    BigInt(model.originMonotonicNs) + BigInt(Math.round(wallDelta * model.slope));
  const combinedUncertaintyNs = Math.sqrt(
    Math.max(0, event.uncertaintyNs) ** 2 +
      Math.max(0, model.estimatedMappingUncertaintyNs) ** 2,
  );
  return {
    ...event,
    scannerMonotonicTimestampNs: String(monotonic),
    combinedUncertaintyNs,
  };
}

export function mapReferenceEventsToScannerClock(
  events: ScannerReferenceEvent[],
  model: ScannerClockModel,
) {
  return events.flatMap((event) => {
    const mapped = mapReferenceEventToScannerClock(event, model);
    return mapped ? [mapped] : [];
  });
}

export function clockIntervalVariation(frames: RawRadioFrame[]) {
  const intervals: number[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    const delta = Number(scannerTimestampNs(frames[index]!) - scannerTimestampNs(frames[index - 1]!));
    if (delta > 0) intervals.push(delta);
  }
  const average = mean(intervals);
  return average > 0 ? standardDeviation(intervals) / average : 1;
}
