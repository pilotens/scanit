import type {
  WifiCsiCalibration,
  WifiCsiFrame,
  WifiSensingAnalysis,
  WifiSensingCapture,
  WifiSensingQualityGate,
} from '@/domain/wifiSensing';

import { normalizeWifiCsiFrame, wifiLinkId } from './calibration';

const EPSILON = 1e-12;
type Complex = { real: number; imaginary: number };

type TimePoint = {
  soundingSequence: number;
  timestampNs: bigint;
  phaseRadians: number;
  subcarrierCoherence: number;
};

type SpectrumPoint = {
  frequencyHz: number;
  real: number;
  imaginary: number;
  power: number;
};

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const standardDeviation = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, value));

const magnitude = (value: Complex) => Math.hypot(value.real, value.imaginary);
const phase = (value: Complex) => Math.atan2(value.imaginary, value.real);

const wrapPhase = (value: number) => {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  while (wrapped < -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
};

const divideComplex = (left: Complex, right: Complex): Complex => {
  const denominator = right.real ** 2 + right.imaginary ** 2;
  if (denominator <= EPSILON) return { real: 0, imaginary: 0 };
  return {
    real: (left.real * right.real + left.imaginary * right.imaginary) / denominator,
    imaginary: (left.imaginary * right.real - left.real * right.imaginary) / denominator,
  };
};

const averageUnitComplex = (values: Complex[]): Complex => {
  const usable = values.filter((value) => magnitude(value) > EPSILON);
  if (!usable.length) return { real: 0, imaginary: 0 };
  return {
    real: mean(usable.map((value) => value.real / magnitude(value))),
    imaginary: mean(usable.map((value) => value.imaginary / magnitude(value))),
  };
};

const frameTimestamp = (frame: WifiCsiFrame) => {
  try {
    return BigInt(frame.timing?.monotonicTimestampNs ?? frame.timestampNs);
  } catch {
    return 0n;
  }
};

const detrend = (values: number[]) => {
  if (values.length < 2) return values.map(() => 0);
  const first = values[0] ?? 0;
  const last = values.at(-1) ?? first;
  return values.map(
    (value, index) => value - (first + ((last - first) * index) / (values.length - 1)),
  );
};

const unwrap = (values: number[]) => {
  let previous: number | undefined;
  let cumulative = 0;
  return values.map((value) => {
    if (previous !== undefined) cumulative += wrapPhase(value - previous);
    previous = value;
    return cumulative;
  });
};

const spectrum = (values: number[], sampleRateHz: number): SpectrumPoint[] => {
  if (values.length < 8 || sampleRateHz <= 0) return [];
  const centeredMean = mean(values);
  return Array.from({ length: Math.floor(values.length / 2) }, (_, index) => index + 1).map(
    (bin) => {
      let real = 0;
      let imaginary = 0;
      for (let sample = 0; sample < values.length; sample += 1) {
        const window =
          values.length <= 1
            ? 1
            : 0.5 * (1 - Math.cos((2 * Math.PI * sample) / (values.length - 1)));
        const angle = (-2 * Math.PI * bin * sample) / values.length;
        const value = ((values[sample] ?? 0) - centeredMean) * window;
        real += value * Math.cos(angle);
        imaginary += value * Math.sin(angle);
      }
      return {
        frequencyHz: (bin * sampleRateHz) / values.length,
        real,
        imaginary,
        power: (real ** 2 + imaginary ** 2) / values.length ** 2,
      };
    },
  );
};

const reconstructBand = (
  points: SpectrumPoint[],
  length: number,
  sampleRateHz: number,
  minimumHz: number,
  maximumHz: number,
) => {
  const selected = points.filter(
    ({ frequencyHz }) => frequencyHz >= minimumHz && frequencyHz <= maximumHz,
  );
  return Array.from({ length }, (_, index) =>
    selected.reduce((sum, point) => {
      const angle = 2 * Math.PI * point.frequencyHz * (index / sampleRateHz);
      return sum + (2 / length) * (point.real * Math.cos(angle) - point.imaginary * Math.sin(angle));
    }, 0),
  );
};

const normalizeTrace = (values: number[], maximumPoints = 100) => {
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

const bandEvidence = (
  points: SpectrumPoint[],
  minimumHz: number,
  maximumHz: number,
) => {
  const selected = points.filter(
    ({ frequencyHz }) => frequencyHz >= minimumHz && frequencyHz <= maximumHz,
  );
  const power = selected.reduce((sum, point) => sum + point.power, 0);
  const dominant = selected.reduce<SpectrumPoint | undefined>(
    (best, point) => (!best || point.power > best.power ? point : best),
    undefined,
  );
  const totalPower = points
    .filter(({ frequencyHz }) => frequencyHz >= 0.05 && frequencyHz <= 3.5)
    .reduce((sum, point) => sum + point.power, 0);
  return {
    power,
    dominantFrequencyHz: dominant?.frequencyHz,
    confidence: dominant
      ? clamp((dominant.power / Math.max(power, EPSILON)) * (power / Math.max(totalPower, EPSILON)) * 4)
      : 0,
  };
};

const autocorrelationFrequency = (
  values: number[],
  sampleRateHz: number,
  minimumHz: number,
  maximumHz: number,
) => {
  const centered = detrend(values).map((value) => value - mean(values));
  const minimumLag = Math.max(1, Math.floor(sampleRateHz / maximumHz));
  const maximumLag = Math.min(centered.length - 2, Math.ceil(sampleRateHz / minimumHz));
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
    frequencyHz: bestLag ? sampleRateHz / bestLag : undefined,
    confidence: clamp(bestCorrelation),
  };
};

const buildRatioPoints = (
  frames: WifiCsiFrame[],
  calibration: WifiCsiCalibration,
): { points: TimePoint[]; activeSoundingCount: number; receiverLinkCount: number } => {
  const activeFrames = frames.filter(
    ({ soundingSequence }) => soundingSequence >= calibration.soundingCount,
  );
  const groups = new Map<number, WifiCsiFrame[]>();
  for (const frame of activeFrames) {
    const group = groups.get(frame.soundingSequence) ?? [];
    group.push(frame);
    groups.set(frame.soundingSequence, group);
  }
  const validLinkIds = new Set(calibration.links.filter(({ valid }) => valid).map(({ linkId }) => linkId));
  const points: TimePoint[] = [];

  for (const [soundingSequence, group] of [...groups.entries()].sort(([left], [right]) => left - right)) {
    const usable = group.filter((frame) => validLinkIds.has(wifiLinkId(frame)));
    const reference = usable.find((frame) => wifiLinkId(frame) === calibration.referenceLinkId);
    const comparison = usable
      .filter((frame) => frame !== reference)
      .sort((left, right) => right.rssiDbm - left.rssiDbm)[0];
    if (!reference || !comparison) continue;
    const referenceCsi = normalizeWifiCsiFrame(reference, calibration);
    const comparisonCsi = normalizeWifiCsiFrame(comparison, calibration);
    const ratios = referenceCsi.map((value, index) => divideComplex(comparisonCsi[index]!, value));
    const averageRatio = averageUnitComplex(ratios);
    if (magnitude(averageRatio) <= EPSILON) continue;
    points.push({
      soundingSequence,
      timestampNs: frameTimestamp(reference),
      phaseRadians: phase(averageRatio),
      subcarrierCoherence: clamp(magnitude(averageRatio)),
    });
  }

  return {
    points,
    activeSoundingCount: groups.size,
    receiverLinkCount: validLinkIds.size,
  };
};

const evaluateQuality = (input: {
  frames: WifiCsiFrame[];
  calibration: WifiCsiCalibration;
  points: TimePoint[];
  activeSoundingCount: number;
}): WifiSensingQualityGate => {
  const { frames, calibration, points, activeSoundingCount } = input;
  const pairedSoundingRatio = points.length / Math.max(1, activeSoundingCount);
  const intervalsSeconds: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const delta = Number(points[index]!.timestampNs - points[index - 1]!.timestampNs) / 1_000_000_000;
    if (delta > 0) intervalsSeconds.push(delta);
  }
  const averageInterval = mean(intervalsSeconds);
  const estimatedSoundingRateHz = averageInterval > 0 ? 1 / averageInterval : 0;
  const durationSeconds = intervalsSeconds.reduce((sum, value) => sum + value, 0);
  const timingVariation = averageInterval > 0 ? standardDeviation(intervalsSeconds) / averageInterval : 1;
  const averageRssi = mean(frames.map(({ rssiDbm }) => rssiDbm));
  const averageNoise = mean(frames.map(({ noiseFloorDbm }) => noiseFloorDbm));
  const averagePacketSnr = averageRssi - averageNoise;
  const averageCoherence = mean(points.map(({ subcarrierCoherence }) => subcarrierCoherence));
  const clockDomains = new Set(frames.map(({ timing }) => timing?.clockDomain).filter(Boolean));
  const timingCoverage = frames.filter(({ timing }) => Boolean(timing)).length / Math.max(1, frames.length);
  const maximumTimingUncertaintyNs = Math.max(
    ...frames.map(({ timing }) => timing?.uncertaintyNs ?? 100_000_000),
    0,
  );

  const calibrationScore = clamp(calibration.qualityScore / 100);
  const pairedScore = clamp((pairedSoundingRatio - 0.5) / 0.45);
  const packetSnrScore = clamp((averagePacketSnr - 20) / 35);
  const coherenceScore = clamp((averageCoherence - 0.25) / 0.7);
  const timingScore = clamp(1 - timingVariation / 0.2);
  const durationScore = clamp(durationSeconds / 8);
  const clockScore = clockDomains.size === 1 && timingCoverage >= 0.98 ? 1 : 0;
  const uncertaintyScore = clamp(1 - maximumTimingUncertaintyNs / 20_000_000);

  const metrics: WifiSensingQualityGate['metrics'] = [
    {
      id: 'calibration',
      label: 'CSI-kalibrering',
      value: calibration.qualityScore,
      unit: '%',
      score: calibrationScore,
      passed: calibration.qualityScore >= 70,
      blocking: calibration.qualityScore < 45,
      detail: `${calibration.links.filter(({ valid }) => valid).length}/${calibration.links.length} länkar är giltiga.`,
    },
    {
      id: 'paired-soundings',
      label: 'Samtidiga mottagarlänkar',
      value: pairedSoundingRatio * 100,
      unit: '%',
      score: pairedScore,
      passed: pairedSoundingRatio >= 0.9,
      blocking: pairedSoundingRatio < 0.5,
      detail: `${points.length}/${activeSoundingCount} soundings kunde bilda CSI-kvot.`,
    },
    {
      id: 'packet-snr',
      label: 'Paket-SNR',
      value: averagePacketSnr,
      unit: 'dB',
      score: packetSnrScore,
      passed: averagePacketSnr >= 35,
      blocking: averagePacketSnr < 20,
      detail: `${averagePacketSnr.toFixed(1)} dB från RSSI och rapporterat brusgolv.`,
    },
    {
      id: 'subcarrier-coherence',
      label: 'Subbärarkoherens',
      value: averageCoherence * 100,
      unit: '%',
      score: coherenceScore,
      passed: averageCoherence >= 0.65,
      blocking: averageCoherence < 0.25,
      detail: `${(averageCoherence * 100).toFixed(1)}% enighet i kalibrerad CSI-kvot.`,
    },
    {
      id: 'sounding-timing',
      label: 'Sounding-timing',
      value: timingVariation * 100,
      unit: '% CV',
      score: timingScore,
      passed: timingVariation <= 0.08,
      blocking: timingVariation > 0.35,
      detail: `${(timingVariation * 100).toFixed(1)}% variation mellan soundings.`,
    },
    {
      id: 'clock-domain',
      label: 'Gemensam monoton klocka',
      value: timingCoverage * 100,
      unit: '% frames',
      score: clockScore,
      passed: clockScore === 1,
      blocking: clockDomains.size !== 1 || timingCoverage < 0.9,
      detail: `${clockDomains.size} klockdomän(er), ${(timingCoverage * 100).toFixed(1)}% timingtäckning.`,
    },
    {
      id: 'timestamp-uncertainty',
      label: 'Tidsosäkerhet',
      value: maximumTimingUncertaintyNs / 1_000_000,
      unit: 'ms',
      score: uncertaintyScore,
      passed: maximumTimingUncertaintyNs <= 5_000_000,
      blocking: maximumTimingUncertaintyNs > 20_000_000,
      detail: `Maximal rapporterad osäkerhet ±${(maximumTimingUncertaintyNs / 1_000_000).toFixed(2)} ms.`,
    },
    {
      id: 'duration',
      label: 'Mätlängd',
      value: durationSeconds,
      unit: 's',
      score: durationScore,
      passed: durationSeconds >= 8,
      blocking: durationSeconds < 3,
      detail: `${durationSeconds.toFixed(1)} sekunder analyserbar CSI-kvot.`,
    },
  ];

  const score = Math.round(
    100 *
      (calibrationScore * 0.16 +
        pairedScore * 0.16 +
        packetSnrScore * 0.12 +
        coherenceScore * 0.18 +
        timingScore * 0.1 +
        clockScore * 0.12 +
        uncertaintyScore * 0.08 +
        durationScore * 0.08),
  );
  const blocking = metrics.filter((metric) => metric.blocking);
  const failed = metrics.filter(({ passed }) => !passed);
  const verdict = blocking.length || score < 45 ? 'rejected' : failed.length || score < 72 ? 'repeat' : 'approved';

  return {
    version: 'wifi-sensing-quality-v1',
    verdict,
    score,
    estimatedSoundingRateHz,
    durationSeconds,
    pairedSoundingRatio,
    metrics,
    reasons: failed.map(({ label, detail }) => `${label}: ${detail}`),
  };
};

export function analyzeWifiCsiCapture(
  capture: WifiSensingCapture,
  calibration: WifiCsiCalibration,
): WifiSensingAnalysis {
  const built = buildRatioPoints(capture.frames, calibration);
  const activeFrames = capture.frames.filter(
    ({ soundingSequence }) => soundingSequence >= calibration.soundingCount,
  );
  const qualityGate = evaluateQuality({
    frames: activeFrames,
    calibration,
    points: built.points,
    activeSoundingCount: built.activeSoundingCount,
  });
  const unwrapped = detrend(unwrap(built.points.map(({ phaseRadians }) => phaseRadians)));
  const spectralPoints = spectrum(unwrapped, qualityGate.estimatedSoundingRateHz);
  const respiration = bandEvidence(spectralPoints, 0.1, 0.5);
  const mechanical = bandEvidence(spectralPoints, 0.7, 3.0);
  const mechanicalAutocorrelation = autocorrelationFrequency(
    unwrapped,
    qualityGate.estimatedSoundingRateHz,
    0.7,
    3.0,
  );
  const mechanicalAgreement =
    mechanical.dominantFrequencyHz && mechanicalAutocorrelation.frequencyHz
      ? Math.exp(
          -Math.abs(mechanical.dominantFrequencyHz - mechanicalAutocorrelation.frequencyHz) / 0.2,
        ) * mechanicalAutocorrelation.confidence
      : 0;
  const respirationConfidence = clamp(respiration.confidence * (qualityGate.score / 100));
  const mechanicalConfidence = clamp(
    mechanical.confidence * (0.35 + 0.65 * mechanicalAgreement) * (qualityGate.score / 100),
  );
  const respirationTrace = reconstructBand(
    spectralPoints,
    unwrapped.length,
    qualityGate.estimatedSoundingRateHz,
    0.1,
    0.5,
  );
  const mechanicalTrace = reconstructBand(
    spectralPoints,
    unwrapped.length,
    qualityGate.estimatedSoundingRateHz,
    0.7,
    3.0,
  );
  const multipathStability = mean(built.points.map(({ subcarrierCoherence }) => subcarrierCoherence));
  const qualityFlags: string[] = [];
  if (qualityGate.verdict !== 'approved') qualityFlags.push('wifi-quality-not-approved');
  if (respirationConfidence < 0.25) qualityFlags.push('wifi-respiration-not-resolved');
  if (mechanicalConfidence < 0.2) qualityFlags.push('wifi-mechanical-not-resolved');
  if (mechanicalAgreement < 0.3) qualityFlags.push('wifi-mechanical-methods-disagree');
  if (multipathStability < 0.55) qualityFlags.push('wifi-multipath-unstable');

  return {
    version: 'wifi-csi-vitals-v1',
    sessionId: capture.id,
    calibrationId: calibration.id,
    qualityGate,
    soundingCount: built.points.length,
    receiverLinkCount: built.receiverLinkCount,
    selectedSubcarrierCount: capture.frames[0]?.subcarrierIndices.length ?? 0,
    relativePhaseTrace: normalizeTrace(unwrapped),
    respirationTrace: normalizeTrace(respirationTrace),
    mechanicalTrace: normalizeTrace(mechanicalTrace),
    respiratoryRateBpm:
      qualityGate.durationSeconds >= 8 && respiration.dominantFrequencyHz
        ? respiration.dominantFrequencyHz * 60
        : undefined,
    mechanicalRateBpm:
      qualityGate.durationSeconds >= 8 && mechanical.dominantFrequencyHz
        ? mechanical.dominantFrequencyHz * 60
        : undefined,
    respirationConfidence,
    mechanicalConfidence,
    multipathStability,
    claims: [
      {
        id: 'respiratory-periodicity',
        state:
          qualityGate.verdict === 'approved' && respirationConfidence >= 0.25
            ? 'supported-as-engineering-signal'
            : 'experimental',
        explanation: 'Kalibrerad CSI-kvot innehåller periodisk RF-modulation i andningsbandet.',
      },
      {
        id: 'mechanical-periodicity',
        state:
          qualityGate.verdict === 'approved' && mechanicalConfidence >= 0.2
            ? 'experimental'
            : 'not-validated',
        explanation:
          'Periodisk RF-modulation i hjärtmekaniskt frekvensband kräver synkroniserad EKG/PPG-verifiering.',
      },
      {
        id: 'anatomy',
        state: 'not-supported',
        explanation: 'Commodity CSI har ingen validerad intern anatomisk rekonstruktion.',
      },
      {
        id: 'blood-flow',
        state: 'not-supported',
        explanation: 'CSI-kvoten mäter kanalvariation, inte riktat eller kvantifierat blodflöde.',
      },
      {
        id: 'coronary-artery',
        state: 'not-supported',
        explanation: 'Wi-Fi CSI kan inte upplösa eller identifiera kranskärl.',
      },
      {
        id: 'stenosis',
        state: 'not-supported',
        explanation: 'Förträngning kan inte härledas utan validerad kärl- och flödesmätning.',
      },
      {
        id: 'ischemia-infarction',
        state: 'not-validated',
        explanation: 'Ingen kliniskt validerad koppling mellan CSI-mönster och ischemi eller infarkt finns.',
      },
    ],
    qualityFlags,
  };
}