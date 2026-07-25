import type { RawRadioFrame } from '@/domain/radio';

import { mean, standardDeviation } from '../math/complex';
import { computeBasicProfile, type BasicProfile } from './profile';

const SPEED_OF_LIGHT_METERS_PER_SECOND = 299_792_458;

export type ScannerTargetTrack = {
  bins: number[];
  rangesMeters: number[];
  medianBin: number;
  medianRangeMeters?: number;
  confidence: number;
  binStandardDeviation: number;
  rangeGate: { minimumMeters: number; maximumMeters: number };
  qualityFlags: string[];
};

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle] ?? 0
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const bestBin = (
  profile: number[],
  reference: number[],
  minimumBin: number,
  maximumBin: number,
  previousBin?: number,
) => {
  const candidates: Array<{ bin: number; score: number }> = [];
  for (let bin = minimumBin; bin <= maximumBin; bin += 1) {
    if (previousBin !== undefined && Math.abs(bin - previousBin) > 3) continue;
    const continuity = previousBin === undefined ? 1 : Math.max(0, 1 - Math.abs(bin - previousBin) / 4);
    candidates.push({
      bin,
      score: (profile[bin] ?? 0) * 0.55 + (reference[bin] ?? 0) * 0.35 + continuity * 0.1,
    });
  }
  candidates.sort((left, right) => right.score - left.score);
  const selected = candidates[0] ?? { bin: minimumBin, score: 0 };
  const second = candidates[1]?.score ?? 0;
  const margin = selected.score > 0 ? Math.max(0, selected.score - second) / selected.score : 0;
  return { bin: selected.bin, margin };
};

export function trackScannerTarget(
  frames: RawRadioFrame[],
  options: { minimumRangeMeters?: number; maximumRangeMeters?: number } = {},
): ScannerTargetTrack {
  if (!frames.length) throw new Error('Target tracking requires at least one frame.');
  const profiles: BasicProfile[] = frames.map((frame) => computeBasicProfile(frame));
  const profileLength = Math.min(...profiles.map(({ profile }) => profile.length));
  const reference = Array.from({ length: profileLength }, (_, bin) =>
    mean(profiles.map(({ profile }) => profile[bin] ?? 0)),
  );
  const first = frames[0]!;
  const rangeResolution = first.bandwidthHz > 0
    ? SPEED_OF_LIGHT_METERS_PER_SECOND / (2 * first.bandwidthHz)
    : undefined;
  const minimumMeters = options.minimumRangeMeters ?? (first.modality === 'mmwave-fmcw' ? 0.2 : 0);
  const maximumMeters = options.maximumRangeMeters ?? (first.modality === 'mmwave-fmcw' ? 1.2 : Infinity);
  const minimumBin = Math.max(1, rangeResolution ? Math.ceil(minimumMeters / rangeResolution) : 1);
  const maximumBin = Math.max(
    minimumBin,
    Math.min(
      profileLength - 1,
      rangeResolution && Number.isFinite(maximumMeters)
        ? Math.floor(maximumMeters / rangeResolution)
        : profileLength - 1,
    ),
  );

  const bins: number[] = [];
  const margins: number[] = [];
  let previousBin: number | undefined;
  for (const { profile } of profiles) {
    const selected = bestBin(profile, reference, minimumBin, maximumBin, previousBin);
    bins.push(selected.bin);
    margins.push(selected.margin);
    previousBin = selected.bin;
  }

  const binStandardDeviation = standardDeviation(bins);
  const continuityScore = Math.max(0, 1 - binStandardDeviation / 3);
  const confidence = Math.max(0, Math.min(1, mean(margins) * 0.65 + continuityScore * 0.35));
  const medianBin = Math.round(median(bins));
  const qualityFlags: string[] = [];
  if (confidence < 0.25) qualityFlags.push('target-track-low-confidence');
  if (binStandardDeviation > 2) qualityFlags.push('target-track-unstable');
  if (minimumBin >= maximumBin) qualityFlags.push('target-range-gate-empty');

  return {
    bins,
    rangesMeters: rangeResolution ? bins.map((bin) => bin * rangeResolution) : [],
    medianBin,
    medianRangeMeters: rangeResolution ? medianBin * rangeResolution : undefined,
    confidence,
    binStandardDeviation,
    rangeGate: { minimumMeters, maximumMeters },
    qualityFlags,
  };
}
