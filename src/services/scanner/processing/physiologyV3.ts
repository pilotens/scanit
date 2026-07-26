import type { RawRadioFrame, ScannerRxCalibration } from '@/domain/radio';
import type {
  ScannerPhysiologicalSeparation,
  ScannerSignalQualityGate,
} from '@/domain/scannerSignal';

import { mean, phase, wrapPhase, type Complex } from '../math/complex';
import { computeBasicProfile, type BasicProfile } from './profile';

const SPEED_OF_LIGHT_METERS_PER_SECOND = 299_792_458;
const EPSILON = 1e-12;

type SpectrumPoint = {
  frequencyHz: number;
  real: number;
  imaginary: number;
  power: number;
};

type BandResult = {
  power: number;
  dominantFrequencyHz?: number;
  concentration: number;
  trace: number[];
};

const detrend = (values: number[]) => {
  if (values.length < 2) return values.map(() => 0);
  const first = values[0] ?? 0;
  const last = values.at(-1) ?? first;
  return values.map(
    (value, index) =>
      value - first - ((last - first) * index) / (values.length - 1),
  );
};

const spectrum = (values: number[], frameRateHz: number): SpectrumPoint[] => {
  const length = values.length;
  if (length < 4 || frameRateHz <= 0) return [];
  const centeredMean = mean(values);
  const result: SpectrumPoint[] = [];
  for (let bin = 1; bin <= Math.floor(length / 2); bin += 1) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < length; index += 1) {
      const window =
        length <= 1
          ? 1
          : 0.5 * (1 - Math.cos((2 * Math.PI * index) / (length - 1)));
      const angle = (-2 * Math.PI * bin * index) / length;
      const value = ((values[index] ?? 0) - centeredMean) * window;
      real += value * Math.cos(angle);
      imaginary += value * Math.sin(angle);
    }
    result.push({
      frequencyHz: (bin * frameRateHz) / length,
      real,
      imaginary,
      power: (real ** 2 + imaginary ** 2) / length ** 2,
    });
  }
  return result;
};

const reconstructBand = (
  points: SpectrumPoint[],
  length: number,
  frameRateHz: number,
  minimumHz: number,
  maximumHz: number,
) => {
  const selected = points.filter(
    ({ frequencyHz }) => frequencyHz >= minimumHz && frequencyHz <= maximumHz,
  );
  return Array.from({ length }, (_, index) =>
    selected.reduce((sum, point) => {
      const angle = 2 * Math.PI * point.frequencyHz * (index / frameRateHz);
      return (
        sum +
        (2 / length) *
          (point.real * Math.cos(angle) - point.imaginary * Math.sin(angle))
      );
    }, 0),
  );
};

const bandResult = (
  points: SpectrumPoint[],
  length: number,
  frameRateHz: number,
  minimumHz: number,
  maximumHz: number,
): BandResult => {
  const selected = points.filter(
    ({ frequencyHz }) => frequencyHz >= minimumHz && frequencyHz <= maximumHz,
  );
  const power = selected.reduce((sum, point) => sum + point.power, 0);
  const dominant = selected.reduce<SpectrumPoint | undefined>(
    (best, point) => (!best || point.power > best.power ? point : best),
    undefined,
  );
  return {
    power,
    dominantFrequencyHz: dominant?.frequencyHz,
    concentration: dominant ? dominant.power / Math.max(power, EPSILON) : 0,
    trace: reconstructBand(
      points,
      length,
      frameRateHz,
      minimumHz,
      maximumHz,
    ),
  };
};

const autocorrelationRate = (
  values: number[],
  frameRateHz: number,
  minimumHz: number,
  maximumHz: number,
) => {
  const centered = detrend(values);
  const minimumLag = Math.max(1, Math.floor(frameRateHz / maximumHz));
  const maximumLag = Math.min(
    values.length - 2,
    Math.ceil(frameRateHz / minimumHz),
  );
  let bestLag: number | undefined;
  let bestCorrelation = -1;
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    let numerator = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = 0; index + lag < centered.length; index += 1) {
      const left = centered[index] ?? 0;
      const right = centered[index + lag] ?? 0;
      numerator += left * right;
      leftEnergy += left ** 2;
      rightEnergy += right ** 2;
    }
    const denominator = Math.sqrt(leftEnergy * rightEnergy);
    const correlation = denominator > EPSILON ? numerator / denominator : 0;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }
  return {
    frequencyHz: bestLag ? frameRateHz / bestLag : undefined,
    confidence: Math.max(0, Math.min(1, bestCorrelation)),
  };
};

const calibratedBinVector = (profile: BasicProfile, bin: number): Complex => {
  if (!profile.spectra?.length) return { real: 0, imaginary: 0 };
  const channel = Math.min(
    profile.referenceRxChannel ?? 0,
    profile.spectra.length - 1,
  );
  return profile.spectra[channel]?.[bin] ?? { real: 0, imaginary: 0 };
};

const displacementTrace = (
  frames: RawRadioFrame[],
  profiles: BasicProfile[],
  bin: number,
) => {
  const wavelength =
    frames[0]!.centerFrequencyHz > 0
      ? SPEED_OF_LIGHT_METERS_PER_SECOND / frames[0]!.centerFrequencyHz
      : 0;
  let previousPhase: number | undefined;
  let cumulativePhase = 0;
  const values: number[] = [];
  for (let index = 0; index < frames.length; index += 1) {
    const current = phase(calibratedBinVector(profiles[index]!, bin));
    if (previousPhase !== undefined) {
      cumulativePhase += wrapPhase(current - previousPhase);
    }
    previousPhase = current;
    values.push(
      wavelength > 0
        ? (cumulativePhase * wavelength * 1000) / (4 * Math.PI)
        : cumulativePhase,
    );
  }
  return detrend(values);
};

const candidateBins = (profiles: BasicProfile[]) => {
  const length = Math.min(...profiles.map(({ profile }) => profile.length));
  return Array.from({ length: Math.max(0, Math.min(length - 1, 48)) }, (_, index) => index + 1)
    .map((bin) => ({
      bin,
      strength: mean(profiles.map(({ profile }) => profile[bin] ?? 0)),
    }))
    .sort((left, right) => right.strength - left.strength)
    .slice(0, 16)
    .map(({ bin }) => bin);
};

const harmonicRisk = (
  cardiacFrequencyHz: number | undefined,
  respirationFrequencyHz: number | undefined,
  resolutionHz: number,
) => {
  if (!cardiacFrequencyHz || !respirationFrequencyHz) return 0;
  const width = Math.max(0.06, resolutionHz * 1.25);
  let risk = 0;
  for (let harmonic = 2; harmonic <= 10; harmonic += 1) {
    const frequency = respirationFrequencyHz * harmonic;
    if (frequency > 3.2) break;
    risk = Math.max(
      risk,
      Math.exp(-0.5 * (Math.abs(cardiacFrequencyHz - frequency) / width) ** 2),
    );
  }
  return Math.max(0, Math.min(1, risk));
};

const normalizeTrace = (values: number[], maximumPoints = 80) => {
  if (!values.length) return [];
  const stride = Math.max(1, Math.ceil(values.length / maximumPoints));
  const reduced: number[] = [];
  for (let index = 0; index < values.length; index += stride) {
    reduced.push(mean(values.slice(index, index + stride)));
  }
  const center = mean(reduced);
  const scale = Math.max(
    ...reduced.map((value) => Math.abs(value - center)),
    EPSILON,
  );
  return reduced.map((value) => (value - center) / scale);
};

export function separateScannerPhysiologyV3(
  frames: RawRadioFrame[],
  qualityGate: ScannerSignalQualityGate,
  rxCalibration?: ScannerRxCalibration,
): ScannerPhysiologicalSeparation {
  const frameRateHz = qualityGate.estimatedFrameRateHz;
  const durationSeconds = qualityGate.durationSeconds;
  const flags: string[] = [];
  if (frames.length < 16 || frameRateHz <= 0) {
    return {
      version: 'scanner-physiology-v3',
      reliable: false,
      frameRateHz,
      durationSeconds,
      respiratoryBandPower: 0,
      cardiacBandPower: 0,
      separationConfidence: 0,
      respirationTrace: [],
      cardiacTrace: [],
      qualityFlags: ['insufficient-time-series'],
    };
  }

  const profiles = frames.map((frame) =>
    computeBasicProfile(frame, undefined, rxCalibration),
  );
  const candidates = candidateBins(profiles).map((bin) => {
    const trace = displacementTrace(frames, profiles, bin);
    const points = spectrum(trace, frameRateHz);
    const respiration = bandResult(points, trace.length, frameRateHz, 0.1, 0.5);
    const cardiac = bandResult(points, trace.length, frameRateHz, 0.7, 3.0);
    const totalPower = points
      .filter(({ frequencyHz }) => frequencyHz >= 0.05 && frequencyHz <= 3.5)
      .reduce((sum, point) => sum + point.power, 0);
    const respirationScore =
      (respiration.power / Math.max(totalPower, EPSILON)) *
      respiration.concentration;
    return { bin, trace, respiration, cardiac, totalPower, respirationScore };
  });
  const respiratory = candidates.reduce<(typeof candidates)[number] | undefined>(
    (best, candidate) =>
      !best || candidate.respirationScore > best.respirationScore
        ? candidate
        : best,
    undefined,
  );
  const respirationFrequencyHz = respiratory?.respiration.dominantFrequencyHz;
  const resolutionHz = frameRateHz / frames.length;
  const cardiacCandidates = candidates.map((candidate) => {
    const autocorrelation = autocorrelationRate(
      candidate.trace,
      frameRateHz,
      0.7,
      3.0,
    );
    const spectralFrequencyHz = candidate.cardiac.dominantFrequencyHz;
    const agreement =
      spectralFrequencyHz && autocorrelation.frequencyHz
        ? Math.exp(
            -Math.abs(spectralFrequencyHz - autocorrelation.frequencyHz) / 0.18,
          ) * autocorrelation.confidence
        : 0;
    const respirationHarmonicRisk = harmonicRisk(
      spectralFrequencyHz,
      respirationFrequencyHz,
      resolutionHz,
    );
    const baseScore =
      (candidate.cardiac.power / Math.max(candidate.totalPower, EPSILON)) *
      candidate.cardiac.concentration *
      (candidate.cardiac.power /
        Math.max(candidate.cardiac.power + candidate.respiration.power, EPSILON));
    return {
      ...candidate,
      autocorrelation,
      agreement,
      respirationHarmonicRisk,
      score:
        baseScore *
        (0.35 + 0.65 * agreement) *
        (1 - respirationHarmonicRisk * 0.85),
    };
  });
  const cardiac = cardiacCandidates.reduce<
    (typeof cardiacCandidates)[number] | undefined
  >(
    (best, candidate) =>
      !best || candidate.score > best.score ? candidate : best,
    undefined,
  );

  if (durationSeconds < 8) flags.push('measurement-duration-short');
  if (qualityGate.verdict !== 'approved') flags.push('signal-quality-not-approved');
  if (!rxCalibration) flags.push('rx-calibration-missing');
  if ((rxCalibration?.qualityScore ?? 0) < 60) flags.push('rx-calibration-low-quality');
  if (!respirationFrequencyHz) flags.push('respiration-band-not-resolved');
  if (!cardiac?.cardiac.dominantFrequencyHz) flags.push('cardiac-band-not-resolved');
  if ((cardiac?.respirationHarmonicRisk ?? 0) > 0.6) {
    flags.push('cardiac-peak-may-be-respiration-harmonic');
  }
  if ((cardiac?.agreement ?? 0) < 0.35) flags.push('cardiac-methods-disagree');

  const separationConfidence = Math.max(
    0,
    Math.min(
      1,
      Math.sqrt(
        Math.max(0, respiratory?.respirationScore ?? 0) *
          Math.max(0, cardiac?.score ?? 0),
      ) *
        5 *
        (qualityGate.score / 100) *
        ((rxCalibration?.qualityScore ?? 0) / 100),
    ),
  );
  const reliable =
    qualityGate.verdict === 'approved' &&
    durationSeconds >= 8 &&
    Boolean(rxCalibration && rxCalibration.qualityScore >= 60) &&
    separationConfidence >= 0.22 &&
    (cardiac?.agreement ?? 0) >= 0.35 &&
    (cardiac?.respirationHarmonicRisk ?? 1) < 0.75 &&
    Boolean(cardiac?.cardiac.dominantFrequencyHz);
  const rangeResolution =
    frames[0]!.bandwidthHz > 0
      ? SPEED_OF_LIGHT_METERS_PER_SECOND / (2 * frames[0]!.bandwidthHz)
      : undefined;

  return {
    version: 'scanner-physiology-v3',
    reliable,
    frameRateHz,
    durationSeconds,
    respirationBin: respiratory?.bin,
    cardiacBin: cardiac?.bin,
    respirationRangeMeters:
      respiratory && rangeResolution ? respiratory.bin * rangeResolution : undefined,
    cardiacRangeMeters:
      cardiac && rangeResolution ? cardiac.bin * rangeResolution : undefined,
    respiratoryRateBpm:
      durationSeconds >= 8 && respirationFrequencyHz
        ? respirationFrequencyHz * 60
        : undefined,
    cardiacMechanicalRateBpm:
      durationSeconds >= 8 && cardiac?.cardiac.dominantFrequencyHz
        ? cardiac.cardiac.dominantFrequencyHz * 60
        : undefined,
    cardiacAutocorrelationRateBpm:
      durationSeconds >= 8 && cardiac?.autocorrelation.frequencyHz
        ? cardiac.autocorrelation.frequencyHz * 60
        : undefined,
    respiratoryBandPower: respiratory?.respiration.power ?? 0,
    cardiacBandPower: cardiac?.cardiac.power ?? 0,
    separationConfidence,
    spectralAutocorrelationAgreement: cardiac?.agreement,
    respirationHarmonicRisk: cardiac?.respirationHarmonicRisk,
    respirationTrace: normalizeTrace(respiratory?.respiration.trace ?? []),
    cardiacTrace: normalizeTrace(cardiac?.cardiac.trace ?? []),
    qualityFlags: [...new Set(flags)],
  };
}
