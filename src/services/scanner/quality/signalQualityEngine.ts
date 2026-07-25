import type { RawRadioFrame, ScannerFrameAnalysis } from '@/domain/radio';
import type { ScannerSignalQualityGate } from '@/domain/scannerSignal';

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const standardDeviation = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, value));

const timestampIntervalsSeconds = (frames: RawRadioFrame[]) => {
  const intervals: number[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    try {
      const delta = Number(BigInt(frames[index]!.timestampNs) - BigInt(frames[index - 1]!.timestampNs));
      if (delta > 0) intervals.push(delta / 1_000_000_000);
    } catch {
      // Missing interval reduces the timing score below.
    }
  }
  return intervals;
};

const countSequenceGaps = (frames: RawRadioFrame[]) => {
  let gaps = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const difference = frames[index]!.sequence - frames[index - 1]!.sequence;
    if (difference > 1) gaps += difference - 1;
    if (difference <= 0) gaps += 1;
  }
  return gaps;
};

export function evaluateScannerSignalQuality(
  frames: RawRadioFrame[],
  analyses: ScannerFrameAnalysis[],
): ScannerSignalQualityGate {
  if (!frames.length || !analyses.length) {
    return {
      version: 'scanner-quality-v2',
      evaluatedAt: new Date().toISOString(),
      verdict: 'rejected',
      score: 0,
      usableFrameRatio: 0,
      estimatedFrameRateHz: 0,
      durationSeconds: 0,
      metrics: [],
      reasons: ['Inspelningen innehåller inga analyserbara scannerframes.'],
      recommendedAction: 'Gör om mätningen och kontrollera scanneranslutningen.',
    };
  }

  const intervals = timestampIntervalsSeconds(frames);
  const averageInterval = mean(intervals);
  const frameRateHz = averageInterval > 0 ? 1 / averageInterval : 0;
  const durationSeconds = intervals.reduce((sum, value) => sum + value, 0);
  const timingVariation = averageInterval > 0 ? standardDeviation(intervals) / averageInterval : 1;
  const sequenceGaps = countSequenceGaps(frames);
  const averageSnr = mean(analyses.map(({ signalToNoiseRatioDb }) => signalToNoiseRatioDb));
  const ranges = analyses.flatMap(({ targetRangeMeters }) =>
    targetRangeMeters === undefined ? [] : [targetRangeMeters],
  );
  const rangeDeviation = standardDeviation(ranges);
  const targetBinDeviation = standardDeviation(analyses.map(({ targetBin }) => targetBin));
  const phaseDeltas = analyses.flatMap(({ phaseDeltaRadians }) =>
    phaseDeltaRadians === undefined ? [] : [Math.abs(phaseDeltaRadians)],
  );
  const phaseJumpRatio = phaseDeltas.length
    ? phaseDeltas.filter((value) => value > 1.2).length / phaseDeltas.length
    : 1;
  const motionContaminated = analyses.filter(({ qualityFlags }) =>
    qualityFlags.includes('device-motion'),
  ).length;
  const motionRatio = motionContaminated / analyses.length;
  const usableFrames = analyses.filter(
    ({ signalQuality, qualityFlags }) =>
      signalQuality !== 'poor' &&
      !qualityFlags.includes('device-motion') &&
      !qualityFlags.includes('flat-signal') &&
      !qualityFlags.includes('chirp-information-lost'),
  ).length;
  const usableFrameRatio = usableFrames / analyses.length;
  const flatSignalRatio = analyses.filter(({ qualityFlags }) =>
    qualityFlags.includes('flat-signal'),
  ).length / analyses.length;

  const chirpCoherences = analyses.flatMap(({ chirpCoherence }) =>
    chirpCoherence === undefined ? [] : [chirpCoherence],
  );
  const rxCoherences = analyses.flatMap(({ rxCoherence }) =>
    rxCoherence === undefined ? [] : [rxCoherence],
  );
  const targetConfidences = analyses.flatMap(({ targetConfidence }) =>
    targetConfidence === undefined ? [] : [targetConfidence],
  );
  const averageChirpCoherence = chirpCoherences.length ? mean(chirpCoherences) : 0.5;
  const averageRxCoherence = rxCoherences.length ? mean(rxCoherences) : 0.5;
  const averageTargetConfidence = targetConfidences.length ? mean(targetConfidences) : 0.5;
  const mmwaveFrames = frames.filter(({ modality }) => modality === 'mmwave-fmcw');
  const rawCubeRatio = mmwaveFrames.length
    ? mmwaveFrames.filter(
        ({ acquisition, dataLayout }) =>
          dataLayout === 'rx-chirp-sample' &&
          (acquisition?.chirpsPerFrame ?? 0) > 1 &&
          acquisition?.chirpReduction === 'none',
      ).length / mmwaveFrames.length
    : 1;
  const nearFieldRatio = analyses.filter(({ qualityFlags }) =>
    qualityFlags.includes('near-field-unvalidated'),
  ).length / analyses.length;

  const packetScore = clamp(1 - sequenceGaps / Math.max(1, frames.length * 0.03));
  const snrScore = clamp((averageSnr - 3) / 17);
  const timingScore = clamp(1 - timingVariation / 0.2);
  const rangeScore = clamp(1 - rangeDeviation / 0.03);
  const targetScore = clamp(1 - targetBinDeviation / 2.5);
  const phaseScore = clamp(1 - phaseJumpRatio / 0.25);
  const motionScore = clamp(1 - motionRatio / 0.2);
  const usableScore = clamp((usableFrameRatio - 0.35) / 0.55);
  const durationScore = clamp(durationSeconds / 5);
  const chirpScore = clamp((averageChirpCoherence - 0.2) / 0.65);
  const rxScore = clamp((averageRxCoherence - 0.1) / 0.65);
  const targetConfidenceScore = clamp((averageTargetConfidence - 0.2) / 0.65);

  const metrics: ScannerSignalQualityGate['metrics'] = [
    {
      id: 'raw-cube-preservation',
      label: 'Rå radarkub',
      value: rawCubeRatio * 100,
      unit: '% frames',
      score: rawCubeRatio,
      passed: rawCubeRatio >= 0.98,
      blocking: mmwaveFrames.length > 0 && rawCubeRatio < 0.9,
      detail: `${(rawCubeRatio * 100).toFixed(1)}% bevarar RX × chirp × ADC utan chirpmedelvärde.`,
    },
    {
      id: 'packet-integrity',
      label: 'Paketintegritet',
      value: sequenceGaps,
      unit: 'luckor',
      score: packetScore,
      passed: sequenceGaps <= Math.max(1, frames.length * 0.01),
      blocking: sequenceGaps > Math.max(4, frames.length * 0.05),
      detail: `${sequenceGaps} saknade, dubbla eller felordnade sekvenser.`,
    },
    {
      id: 'signal-to-noise',
      label: 'Signal–brusförhållande',
      value: averageSnr,
      unit: 'dB',
      score: snrScore,
      passed: averageSnr >= 9,
      blocking: averageSnr < 3,
      detail: `${averageSnr.toFixed(1)} dB i genomsnitt.`,
    },
    {
      id: 'chirp-coherence',
      label: 'Chirpkoherens',
      value: averageChirpCoherence * 100,
      unit: '%',
      score: chirpScore,
      passed: averageChirpCoherence >= 0.55,
      blocking: chirpCoherences.length > 0 && averageChirpCoherence < 0.2,
      detail: `${(averageChirpCoherence * 100).toFixed(1)}% fasöverensstämmelse inom frames.`,
    },
    {
      id: 'rx-coherence',
      label: 'RX-koherens',
      value: averageRxCoherence * 100,
      unit: '%',
      score: rxScore,
      passed: averageRxCoherence >= 0.3,
      blocking: false,
      detail: `${(averageRxCoherence * 100).toFixed(1)}% överensstämmelse mellan mottagarantenner.`,
    },
    {
      id: 'target-confidence',
      label: 'Målförtroende',
      value: averageTargetConfidence * 100,
      unit: '%',
      score: targetConfidenceScore,
      passed: averageTargetConfidence >= 0.55,
      blocking: averageTargetConfidence < 0.2,
      detail: `${(averageTargetConfidence * 100).toFixed(1)}% kombinerat SNR- och koherensstöd.`,
    },
    {
      id: 'frame-timing',
      label: 'Tidsstabilitet',
      value: timingVariation * 100,
      unit: '% CV',
      score: timingScore,
      passed: timingVariation <= 0.08,
      blocking: timingVariation > 0.35 || intervals.length < frames.length - 3,
      detail: `${(timingVariation * 100).toFixed(1)}% variation mellan frames.`,
    },
    {
      id: 'range-stability',
      label: 'Range-stabilitet',
      value: rangeDeviation * 1000,
      unit: 'mm',
      score: rangeScore,
      passed: rangeDeviation <= 0.01,
      blocking: rangeDeviation > 0.05,
      detail: `${(rangeDeviation * 1000).toFixed(1)} mm standardavvikelse.`,
    },
    {
      id: 'target-stability',
      label: 'Målbin-stabilitet',
      value: targetBinDeviation,
      unit: 'bin',
      score: targetScore,
      passed: targetBinDeviation <= 0.75,
      blocking: targetBinDeviation > 4,
      detail: `${targetBinDeviation.toFixed(2)} bins standardavvikelse.`,
    },
    {
      id: 'phase-continuity',
      label: 'Faskontinuitet',
      value: phaseJumpRatio * 100,
      unit: '% glapp',
      score: phaseScore,
      passed: phaseJumpRatio <= 0.08,
      blocking: phaseJumpRatio > 0.4,
      detail: `${(phaseJumpRatio * 100).toFixed(1)}% stora fassteg.`,
    },
    {
      id: 'device-motion',
      label: 'Scanner-rörelse',
      value: motionRatio * 100,
      unit: '% frames',
      score: motionScore,
      passed: motionRatio <= 0.05,
      blocking: motionRatio > 0.35,
      detail: `${(motionRatio * 100).toFixed(1)}% rörelsekontaminerade frames.`,
    },
    {
      id: 'validated-standoff',
      label: 'Validerat avståndsområde',
      value: nearFieldRatio * 100,
      unit: '% nära',
      score: 1 - nearFieldRatio,
      passed: nearFieldRatio === 0,
      blocking: nearFieldRatio > 0.5,
      detail: nearFieldRatio
        ? `${(nearFieldRatio * 100).toFixed(1)}% ligger under BGT60TR13C-spårets validerade 20 cm-gräns.`
        : 'Målet ligger utanför den markerade, ännu ovaliderade närfältszonen.',
    },
    {
      id: 'usable-frames',
      label: 'Användbara frames',
      value: usableFrameRatio * 100,
      unit: '%',
      score: usableScore,
      passed: usableFrameRatio >= 0.8,
      blocking: usableFrameRatio < 0.35 || flatSignalRatio > 0.25,
      detail: `${(usableFrameRatio * 100).toFixed(1)}% uppfyller minimikraven.`,
    },
    {
      id: 'duration',
      label: 'Mätlängd',
      value: durationSeconds,
      unit: 's',
      score: durationScore,
      passed: durationSeconds >= 5,
      blocking: durationSeconds < 1.5,
      detail: `${durationSeconds.toFixed(1)} sekunder analyserbar data.`,
    },
  ];

  const score = Math.round(
    100 *
      (rawCubeRatio * 0.1 +
        packetScore * 0.07 +
        snrScore * 0.14 +
        chirpScore * 0.12 +
        rxScore * 0.05 +
        targetConfidenceScore * 0.1 +
        timingScore * 0.07 +
        rangeScore * 0.08 +
        targetScore * 0.06 +
        phaseScore * 0.08 +
        motionScore * 0.06 +
        usableScore * 0.05 +
        durationScore * 0.02),
  );
  const blocking = metrics.filter((metric) => metric.blocking);
  const failed = metrics.filter(({ passed }) => !passed);

  let verdict: ScannerSignalQualityGate['verdict'];
  if (blocking.length || score < 45) verdict = 'rejected';
  else if (failed.length || score < 75) verdict = 'repeat';
  else verdict = 'approved';

  const reasons = failed.map(({ label, detail }) => `${label}: ${detail}`);
  const recommendedAction =
    verdict === 'approved'
      ? 'Mätningen är tekniskt godkänd för forskningsanalys och baslinjejämförelse.'
      : verdict === 'repeat'
        ? 'Upprepa mätningen med stabilare placering, längre vila och mindre rörelse.'
        : 'Resultatet ska inte tolkas. Kontrollera råkub, anslutning, avstånd och placering innan ny mätning.';

  return {
    version: 'scanner-quality-v2',
    evaluatedAt: new Date().toISOString(),
    verdict,
    score,
    usableFrameRatio,
    estimatedFrameRateHz: frameRateHz,
    durationSeconds,
    metrics,
    reasons,
    recommendedAction,
  };
}
