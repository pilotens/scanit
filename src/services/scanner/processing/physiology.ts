import type { RawRadioFrame } from '@/domain/radio';
import type {
  ScannerPhysiologicalSeparation,
  ScannerSignalQualityGate,
} from '@/domain/scannerSignal';

import { mean, phase, standardDeviation, wrapPhase, type Complex } from '../math/complex';
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
  peakConcentration: number;
  trace: number[];
};

type AutocorrelationResult = {
  dominantFrequencyHz?: number;
  confidence: number;
};

const sumComplex = (values: Complex[]) =>
  values.reduce(
    (sum, value) => ({
      real: sum.real + value.real,
      imaginary: sum.imaginary + value.imaginary,
    }),
    { real: 0, imaginary: 0 },
  );

const directBin = (frame: RawRadioFrame, bin: number): Complex => {
  const values: Complex[] = [];
  for (let channel = 0; channel < frame.channels; channel += 1) {
    const offset = (channel * frame.samplesPerChannel + bin) * 2;
    values.push({
      real: frame.samples[offset] ?? 0,
      imaginary: frame.samples[offset + 1] ?? 0,
    });
  }
  return sumComplex(values);
};

const binComplex = (frame: RawRadioFrame, profile: BasicProfile, bin: number): Complex => {
  if (profile.spectra) {
    const strongest = profile.spectra
      .map((spectrum) => spectrum[bin] ?? { real: 0, imaginary: 0 })
      .sort((left, right) => Math.hypot(right.real, right.imaginary) - Math.hypot(left.real, left.imaginary));
    return strongest[0] ?? { real: 0, imaginary: 0 };
  }
  return directBin(frame, bin);
};

const detrend = (values: number[]) => {
  if (values.length < 2) return values.map(() => 0);
  const first = values[0] ?? 0;
  const last = values.at(-1) ?? first;
  return values.map((value, index) => {
    const trend = first + ((last - first) * index) / (values.length - 1);
    return value - trend;
  });
};

const spectrum = (values: number[], frameRateHz: number): SpectrumPoint[] => {
  const length = values.length;
  if (length < 4 || frameRateHz <= 0) return [];
  const centeredMean = mean(values);
  const centered = values.map((value) => value - centeredMean);
  const result: SpectrumPoint[] = [];
  for (let bin = 1; bin <= Math.floor(length / 2); bin += 1) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < length; index += 1) {
      const window = length <= 1 ? 1 : 0.5 * (1 - Math.cos((2 * Math.PI * index) / (length - 1)));
      const angle = (-2 * Math.PI * bin * index) / length;
      const value = (centered[index] ?? 0) * window;
      real += value * Math.cos(angle);
      imaginary += value * Math.sin(angle);
    }
    result.push({
      frequencyHz: (bin * frameRateHz) / length,
      real,
      imaginary,
      power: (real ** 2 + imaginary ** 2) / (length ** 2),
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
  if (!selected.length || length <= 0 || frameRateHz <= 0) return Array.from({ length }, () => 0);
  return Array.from({ length }, (_, index) =>
    selected.reduce((sum, point) => {
      const angle = 2 * Math.PI * point.frequencyHz * (index / frameRateHz);
      return sum + (2 / length) * (point.real * Math.cos(angle) - point.imaginary * Math.sin(angle));
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
    peakConcentration: dominant ? dominant.power / Math.max(power, EPSILON) : 0,
    trace: reconstructBand(points, length, frameRateHz, minimumHz, maximumHz),
  };
};

const autocorrelationRate = (
  values: number[],
  frameRateHz: number,
  minimumHz: number,
  maximumHz: number,
): AutocorrelationResult => {
  if (values.length < 8 || frameRateHz <= 0) return { confidence: 0 };
  const centered = detrend(values).map((value) => value - mean(values));
  const minimumLag = Math.max(1, Math.floor(frameRateHz / maximumHz));
  const maximumLag = Math.min(values.length - 2, Math.ceil(frameRateHz / minimumHz));
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
    dominantFrequencyHz: bestLag ? frameRateHz / bestLag : undefined,
    confidence: Math.max(0, Math.min(1, bestCorrelation)),
  };
};

const respirationHarmonicRisk = (
  cardiacFrequencyHz: number | undefined,
  respirationFrequencyHz: number | undefined,
  resolutionHz: number,
) => {
  if (!cardiacFrequencyHz || !respirationFrequencyHz) return 0;
  let risk = 0;
  const width = Math.max(0.06, resolutionHz * 1.25);
  for (let harmonic = 2; harmonic <= 10; harmonic += 1) {
    const candidate = respirationFrequencyHz * harmonic;
    if (candidate > 3.2) break;
    const distance = Math.abs(cardiacFrequencyHz - candidate);
    risk = Math.max(risk, Math.exp(-0.5 * (distance / width) ** 2));
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
  const scale = Math.max(...reduced.map((value) => Math.abs(value - center)), EPSILON);
  return reduced.map((value) => (value - center) / scale);
};

const buildDisplacementTrace = (
  frames: RawRadioFrame[],
  profiles: BasicProfile[],
  bin: number,
) => {
  const wavelength = frames[0]!.centerFrequencyHz > 0
    ? SPEED_OF_LIGHT_METERS_PER_SECOND / frames[0]!.centerFrequencyHz
    : 0;
  let previousPhase: number | undefined;
  let cumulativePhase = 0;
  const values: number[] = [];
  for (let index = 0; index < frames.length; index += 1) {
    const current = phase(binComplex(frames[index]!, profiles[index]!, bin));
    if (previousPhase !== undefined) cumulativePhase += wrapPhase(current - previousPhase);
    previousPhase = current;
    values.push(wavelength > 0 ? (cumulativePhase * wavelength * 1000) / (4 * Math.PI) : cumulativePhase);
  }
  return detrend(values);
};

const candidateBins = (profiles: BasicProfile[]) => {
  const length = Math.min(...profiles.map(({ profile }) => profile.length));
  const maximumBin = Math.min(length - 1, 48);
  return Array.from({ length: Math.max(0, maximumBin) }, (_, index) => index + 1)
    .map((bin) => ({ bin, strength: mean(profiles.map(({ profile }) => profile[bin] ?? 0)) }))
    .sort((left, right) => right.strength - left.strength)
    .slice(0, 16)
    .map(({ bin }) => bin);
};

export function separateScannerPhysiology(
  frames: RawRadioFrame[],
  qualityGate: ScannerSignalQualityGate,
): ScannerPhysiologicalSeparation {
  const flags: string[] = [];
  const frameRateHz = qualityGate.estimatedFrameRateHz;
  const durationSeconds = qualityGate.durationSeconds;
  if (frames.length < 16 || frameRateHz <= 0) {
    return {
      version: 'scanner-physiology-v2',
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

  const profiles = frames.map((frame) => computeBasicProfile(frame));
  const bins = candidateBins(profiles);
  const candidates = bins.map((bin) => {
    const trace = buildDisplacementTrace(frames, profiles, bin);
    const points = spectrum(trace, frameRateHz);
    const respiration = bandResult(points, trace.length, frameRateHz, 0.1, 0.5);
    const cardiac = bandResult(points, trace.length, frameRateHz, 0.7, 3.0);
    const totalPower = points
      .filter(({ frequencyHz }) => frequencyHz >= 0.05 && frequencyHz <= 3.5)
      .reduce((sum, point) => sum + point.power, 0);
    const respirationScore =
      (respiration.power / Math.max(totalPower, EPSILON)) * respiration.peakConcentration;
    return { bin, trace, respiration, cardiac, totalPower, respirationScore };
  });

  const respiratoryCandidate = candidates.reduce<(typeof candidates)[number] | undefined>(
    (best, candidate) => (!best || candidate.respirationScore > best.respirationScore ? candidate : best),
    undefined,
  );
  const respirationFrequency = respiratoryCandidate?.respiration.dominantFrequencyHz;
  const frequencyResolution = frameRateHz / Math.max(frames.length, 1);

  const cardiacCandidates = candidates.map((candidate) => {
    const spectralFrequency = candidate.cardiac.dominantFrequencyHz;
    const autocorrelation = autocorrelationRate(candidate.trace, frameRateHz, 0.7, 3.0);
    const agreement =
      spectralFrequency && autocorrelation.dominantFrequencyHz
        ? Math.exp(-Math.abs(spectralFrequency - autocorrelation.dominantFrequencyHz) / 0.18) *
          autocorrelation.confidence
        : 0;
    const harmonicRisk = respirationHarmonicRisk(
      spectralFrequency,
      respirationFrequency,
      frequencyResolution,
    );
    const baseScore =
      (candidate.cardiac.power / Math.max(candidate.totalPower, EPSILON)) *
      candidate.cardiac.peakConcentration *
      (candidate.cardiac.power /
        Math.max(candidate.cardiac.power + candidate.respiration.power, EPSILON));
    const cardiacScore = baseScore * (0.35 + 0.65 * agreement) * (1 - harmonicRisk * 0.85);
    return { ...candidate, autocorrelation, agreement, harmonicRisk, cardiacScore };
  });
  const cardiacCandidate = cardiacCandidates.reduce<(typeof cardiacCandidates)[number] | undefined>(
    (best, candidate) => (!best || candidate.cardiacScore > best.cardiacScore ? candidate : best),
    undefined,
  );

  if (durationSeconds < 8) flags.push('respiration-duration-short');
  if (durationSeconds < 8) flags.push('cardiac-duration-short');
  if (qualityGate.verdict !== 'approved') flags.push('signal-quality-not-approved');
  if (!respirationFrequency) flags.push('respiration-band-not-resolved');
  if (!cardiacCandidate?.cardiac.dominantFrequencyHz) flags.push('cardiac-band-not-resolved');
  if ((cardiacCandidate?.harmonicRisk ?? 0) > 0.6) flags.push('cardiac-peak-may-be-respiration-harmonic');
  if ((cardiacCandidate?.agreement ?? 0) < 0.35) flags.push('cardiac-methods-disagree');

  const respirationScore = respiratoryCandidate?.respirationScore ?? 0;
  const cardiacScore = cardiacCandidate?.cardiacScore ?? 0;
  const spectralConfidence = Math.sqrt(Math.max(0, respirationScore) * Math.max(0, cardiacScore));
  const stabilityPenalty = Math.min(
    1,
    standardDeviation(cardiacCandidate?.trace ?? []) /
      Math.max(0.05, Math.abs(mean(cardiacCandidate?.trace ?? [])) + 1),
  );
  const separationConfidence = Math.max(
    0,
    Math.min(
      1,
      spectralConfidence * 5 * (qualityGate.score / 100) * (1 - stabilityPenalty * 0.15),
    ),
  );
  const reliable =
    qualityGate.verdict === 'approved' &&
    durationSeconds >= 8 &&
    separationConfidence >= 0.22 &&
    (cardiacCandidate?.agreement ?? 0) >= 0.35 &&
    (cardiacCandidate?.harmonicRisk ?? 1) < 0.75 &&
    Boolean(cardiacCandidate?.cardiac.dominantFrequencyHz);

  const rangeResolution = frames[0]!.bandwidthHz > 0
    ? SPEED_OF_LIGHT_METERS_PER_SECOND / (2 * frames[0]!.bandwidthHz)
    : undefined;

  return {
    version: 'scanner-physiology-v2',
    reliable,
    frameRateHz,
    durationSeconds,
    respirationBin: respiratoryCandidate?.bin,
    cardiacBin: cardiacCandidate?.bin,
    respirationRangeMeters:
      respiratoryCandidate && rangeResolution ? respiratoryCandidate.bin * rangeResolution : undefined,
    cardiacRangeMeters:
      cardiacCandidate && rangeResolution ? cardiacCandidate.bin * rangeResolution : undefined,
    respiratoryRateBpm:
      durationSeconds >= 8 && respirationFrequency ? respirationFrequency * 60 : undefined,
    cardiacMechanicalRateBpm:
      durationSeconds >= 8 && cardiacCandidate?.cardiac.dominantFrequencyHz
        ? cardiacCandidate.cardiac.dominantFrequencyHz * 60
        : undefined,
    cardiacAutocorrelationRateBpm:
      durationSeconds >= 8 && cardiacCandidate?.autocorrelation.dominantFrequencyHz
        ? cardiacCandidate.autocorrelation.dominantFrequencyHz * 60
        : undefined,
    respiratoryBandPower: respiratoryCandidate?.respiration.power ?? 0,
    cardiacBandPower: cardiacCandidate?.cardiac.power ?? 0,
    separationConfidence,
    spectralAutocorrelationAgreement: cardiacCandidate?.agreement,
    respirationHarmonicRisk: cardiacCandidate?.harmonicRisk,
    respirationTrace: normalizeTrace(respiratoryCandidate?.respiration.trace ?? []),
    cardiacTrace: normalizeTrace(cardiacCandidate?.cardiac.trace ?? []),
    qualityFlags: [...new Set(flags)],
  };
}
