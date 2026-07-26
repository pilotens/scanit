import type {
  RawRadioFrame,
  ScannerFrameAnalysis,
  ScannerRxCalibration,
} from '@/domain/radio';
import type { ScannerSignalQualityGate } from '@/domain/scannerSignal';
import type {
  ScannerClockModel,
  ScannerCoherentAverage,
  ScannerReferenceEvent,
} from '@/domain/scannerTiming';

import { mean, standardDeviation, wrapPhase } from '../math/complex';
import {
  mapReferenceEventsToScannerClock,
  scannerTimestampNs,
} from '../timing/clockModel';
import { computeBasicProfile } from './profile';

const SPEED_OF_LIGHT_METERS_PER_SECOND = 299_792_458;
const EPSILON = 1e-12;
const WINDOW_START_MS = -250;
const WINDOW_END_MS = 750;
const MAX_EVENT_UNCERTAINTY_NS = 20_000_000;

const emptyResult = (
  status: ScannerCoherentAverage['status'],
  reasons: string[],
): ScannerCoherentAverage => ({
  version: 'scanner-event-locked-average-v1',
  status,
  acceptedBeatCount: 0,
  rejectedBeatCount: 0,
  sampleOffsetsMilliseconds: [],
  meanDisplacementMillimeters: [],
  standardDeviationMillimeters: [],
  standardErrorMillimeters: [],
  beatCoherence: 0,
  theoreticalCoherentGainDb: 0,
  estimatedTimingUncertaintyMilliseconds: 0,
  windowStartMilliseconds: WINDOW_START_MS,
  windowEndMilliseconds: WINDOW_END_MS,
  reasons,
});

const unwrapPhaseSeries = (
  frames: RawRadioFrame[],
  analyses: ScannerFrameAnalysis[],
  targetBin: number | undefined,
  rxCalibration: ScannerRxCalibration | undefined,
) => {
  let previous: number | undefined;
  let cumulative = 0;
  const points: Array<{ timestampNs: bigint; phase: number; usable: boolean }> = [];
  for (let index = 0; index < Math.min(frames.length, analyses.length); index += 1) {
    const frame = frames[index]!;
    const analysis = analyses[index]!;
    const current =
      targetBin === undefined
        ? analysis.phaseRadians
        : computeBasicProfile(frame, targetBin, rxCalibration).targetPhaseRadians;
    if (current === undefined || !Number.isFinite(current)) continue;
    if (previous !== undefined) cumulative += wrapPhase(current - previous);
    previous = current;
    points.push({
      timestampNs: scannerTimestampNs(frame),
      phase: cumulative,
      usable:
        analysis.signalQuality !== 'poor' &&
        !analysis.qualityFlags.includes('device-motion') &&
        !analysis.qualityFlags.includes('flat-signal') &&
        !analysis.qualityFlags.includes('low-chirp-coherence'),
    });
  }
  return points;
};

const interpolate = (
  points: Array<{ timestampNs: bigint; phase: number; usable: boolean }>,
  timestampNs: bigint,
) => {
  if (
    points.length < 2 ||
    timestampNs < points[0]!.timestampNs ||
    timestampNs > points.at(-1)!.timestampNs
  ) {
    return undefined;
  }
  let low = 0;
  let high = points.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle]!.timestampNs <= timestampNs) low = middle;
    else high = middle;
  }
  const left = points[low]!;
  const right = points[high]!;
  const denominator = Number(right.timestampNs - left.timestampNs);
  if (denominator <= 0) return undefined;
  const fraction = Number(timestampNs - left.timestampNs) / denominator;
  return {
    phase: left.phase + (right.phase - left.phase) * fraction,
    usable: left.usable && right.usable,
  };
};

const removeLinearDrift = (values: number[]) => {
  if (values.length < 2) return [...values];
  const first = values[0] ?? 0;
  const last = values.at(-1) ?? first;
  return values.map(
    (value, index) =>
      value - first - ((last - first) * index) / (values.length - 1),
  );
};

const correlation = (left: number[], right: number[]) => {
  const length = Math.min(left.length, right.length);
  if (length < 2) return 0;
  const leftMean = mean(left.slice(0, length));
  const rightMean = mean(right.slice(0, length));
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < length; index += 1) {
    const a = (left[index] ?? 0) - leftMean;
    const b = (right[index] ?? 0) - rightMean;
    numerator += a * b;
    leftEnergy += a ** 2;
    rightEnergy += b ** 2;
  }
  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  return denominator > EPSILON ? numerator / denominator : 0;
};

export function buildEventLockedCoherentAverage(input: {
  frames: RawRadioFrame[];
  analyses: ScannerFrameAnalysis[];
  referenceEvents: ScannerReferenceEvent[];
  clockModel: ScannerClockModel;
  qualityGate: ScannerSignalQualityGate;
  targetBin?: number;
  rxCalibration?: ScannerRxCalibration;
}): ScannerCoherentAverage {
  const {
    frames,
    analyses,
    referenceEvents,
    clockModel,
    qualityGate,
    targetBin,
    rxCalibration,
  } = input;
  if (!referenceEvents.length) {
    return emptyResult('no-reference-events', [
      'Ingen R-topp- eller PPG-pulsström finns.',
    ]);
  }
  if (qualityGate.verdict === 'rejected') {
    return emptyResult('quality-rejected', [
      'Scannerinspelningen är tekniskt underkänd.',
    ]);
  }
  if (clockModel.status === 'unavailable') {
    return emptyResult('clock-unavailable', [
      'Referenshändelserna kan inte mappas till scannerklockan.',
    ]);
  }
  if (clockModel.estimatedMappingUncertaintyNs > MAX_EVENT_UNCERTAINTY_NS) {
    const result = emptyResult('timing-unreliable', [
      `Klockmodellens osäkerhet är ${(clockModel.estimatedMappingUncertaintyNs / 1_000_000).toFixed(1)} ms.`,
    ]);
    result.estimatedTimingUncertaintyMilliseconds =
      clockModel.estimatedMappingUncertaintyNs / 1_000_000;
    return result;
  }

  const points = unwrapPhaseSeries(
    frames,
    analyses,
    targetBin,
    rxCalibration,
  );
  if (points.length < 8) {
    return emptyResult('insufficient-events', [
      'För få faskontinuerliga scannerframes.',
    ]);
  }
  const mappedEvents = mapReferenceEventsToScannerClock(
    referenceEvents,
    clockModel,
  );
  const frameRateHz = Math.max(1, qualityGate.estimatedFrameRateHz);
  const stepMilliseconds = Math.max(20, Math.min(50, 1000 / frameRateHz));
  const sampleOffsetsMilliseconds: number[] = [];
  for (
    let offset = WINDOW_START_MS;
    offset <= WINDOW_END_MS + 0.1;
    offset += stepMilliseconds
  ) {
    sampleOffsetsMilliseconds.push(Math.round(offset * 1000) / 1000);
  }
  const wavelength =
    frames[0]!.centerFrequencyHz > 0
      ? SPEED_OF_LIGHT_METERS_PER_SECOND / frames[0]!.centerFrequencyHz
      : 0;
  const millimetersPerRadian =
    wavelength > 0 ? (wavelength * 1000) / (4 * Math.PI) : 1;
  const segments: number[][] = [];
  let rejectedBeatCount = referenceEvents.length - mappedEvents.length;
  const acceptedUncertainties: number[] = [];

  for (const event of mappedEvents) {
    if (
      event.quality < 0.5 ||
      event.combinedUncertaintyNs > MAX_EVENT_UNCERTAINTY_NS
    ) {
      rejectedBeatCount += 1;
      continue;
    }
    const eventTimestamp = BigInt(event.scannerMonotonicTimestampNs);
    const zero = interpolate(points, eventTimestamp);
    if (!zero?.usable) {
      rejectedBeatCount += 1;
      continue;
    }
    const segment: number[] = [];
    let usable = true;
    for (const offsetMilliseconds of sampleOffsetsMilliseconds) {
      const timestamp =
        eventTimestamp + BigInt(Math.round(offsetMilliseconds * 1_000_000));
      const sample = interpolate(points, timestamp);
      if (!sample?.usable) {
        usable = false;
        break;
      }
      segment.push((sample.phase - zero.phase) * millimetersPerRadian);
    }
    if (!usable || segment.length !== sampleOffsetsMilliseconds.length) {
      rejectedBeatCount += 1;
      continue;
    }
    segments.push(removeLinearDrift(segment));
    acceptedUncertainties.push(event.combinedUncertaintyNs);
  }

  if (segments.length < 3) {
    const result = emptyResult('insufficient-events', [
      'Minst tre kompletta och tidsmässigt säkra hjärtcykler krävs.',
    ]);
    result.rejectedBeatCount = rejectedBeatCount;
    return result;
  }

  const meanDisplacementMillimeters = sampleOffsetsMilliseconds.map(
    (_, index) => mean(segments.map((segment) => segment[index] ?? 0)),
  );
  const standardDeviationMillimeters = sampleOffsetsMilliseconds.map(
    (_, index) => standardDeviation(segments.map((segment) => segment[index] ?? 0)),
  );
  const standardErrorMillimeters = standardDeviationMillimeters.map(
    (value) => value / Math.sqrt(segments.length),
  );
  const beatCoherence = Math.max(
    0,
    Math.min(
      1,
      mean(
        segments.map((segment) =>
          Math.max(-1, correlation(segment, meanDisplacementMillimeters)),
        ),
      ),
    ),
  );
  const sources = [...new Set(mappedEvents.map(({ source }) => source))];
  const reasons: string[] = [];
  if (clockModel.status === 'degraded') {
    reasons.push('Klockmodellen är användbar men degraderad.');
  }
  if (targetBin === undefined) {
    reasons.push('Hjärt-bandets range-bin saknades; huvudmålets fas användes.');
  }
  if (beatCoherence < 0.5) {
    reasons.push(
      'De händelselåsta mekaniska vågformerna har låg inbördes likhet.',
    );
  }

  return {
    version: 'scanner-event-locked-average-v1',
    status: 'available',
    referenceSource: sources.length === 1 ? sources[0] : 'mixed',
    acceptedBeatCount: segments.length,
    rejectedBeatCount,
    sampleOffsetsMilliseconds,
    meanDisplacementMillimeters,
    standardDeviationMillimeters,
    standardErrorMillimeters,
    beatCoherence,
    theoreticalCoherentGainDb: 10 * Math.log10(segments.length),
    estimatedTimingUncertaintyMilliseconds:
      mean(acceptedUncertainties) / 1_000_000,
    windowStartMilliseconds: WINDOW_START_MS,
    windowEndMilliseconds: WINDOW_END_MS,
    reasons,
  };
}
