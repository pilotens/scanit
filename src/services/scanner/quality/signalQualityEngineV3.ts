import type { RawRadioFrame, ScannerFrameAnalysis } from '@/domain/radio';
import type { ScannerSignalQualityGate } from '@/domain/scannerSignal';

import { mean, standardDeviation } from '../math/complex';
import { clockIntervalVariation, scannerTimestampNs } from '../timing/clockModel';

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, value));

const countSequenceGaps = (frames: RawRadioFrame[]) => {
  let gaps = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const difference = frames[index]!.sequence - frames[index - 1]!.sequence;
    if (difference > 1) gaps += difference - 1;
    if (difference <= 0) gaps += 1;
  }
  return gaps;
};

const frameRateAndDuration = (frames: RawRadioFrame[]) => {
  const intervals: number[] = [];
  for (let index = 1; index < frames.length; index += 1) {
    try {
      const delta = Number(
        scannerTimestampNs(frames[index]!) - scannerTimestampNs(frames[index - 1]!),
      );
      if (delta > 0) intervals.push(delta / 1_000_000_000);
    } catch {
      // Invalid timestamps reduce clock coverage below.
    }
  }
  const averageInterval = mean(intervals);
  return {
    frameRateHz: averageInterval > 0 ? 1 / averageInterval : 0,
    durationSeconds: intervals.reduce((sum, value) => sum + value, 0),
    intervalCount: intervals.length,
  };
};

export function evaluateScannerSignalQualityV3(
  frames: RawRadioFrame[],
  analyses: ScannerFrameAnalysis[],
): ScannerSignalQualityGate {
  if (!frames.length || !analyses.length) {
    return {
      version: 'scanner-quality-v3',
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

  const { frameRateHz, durationSeconds, intervalCount } =
    frameRateAndDuration(frames);
  const timingVariation = clockIntervalVariation(frames);
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
  const motionRatio =
    analyses.filter(({ qualityFlags }) => qualityFlags.includes('device-motion')).length /
    analyses.length;
  const usableFrames = analyses.filter(
    ({ signalQuality, qualityFlags }) =>
      signalQuality !== 'poor' &&
      !qualityFlags.includes('device-motion') &&
      !qualityFlags.includes('flat-signal') &&
      !qualityFlags.includes('chirp-information-lost') &&
      !qualityFlags.includes('rx-calibration-missing'),
  ).length;
  const usableFrameRatio = usableFrames / analyses.length;

  const mmwaveFrames = frames.filter(({ modality }) => modality === 'mmwave-fmcw');
  const mmwaveAnalyses = analyses.filter(({ modality }) => modality === 'mmwave-fmcw');
  const rawCubeRatio = mmwaveFrames.length
    ? mmwaveFrames.filter(
        ({ acquisition, dataLayout }) =>
          dataLayout === 'rx-chirp-sample' &&
          (acquisition?.chirpsPerFrame ?? 0) > 1 &&
          acquisition?.chirpReduction === 'none',
      ).length / mmwaveFrames.length
    : 1;
  const calibrationCoverage = mmwaveAnalyses.length
    ? mmwaveAnalyses.filter(({ rxCalibrationApplied }) => rxCalibrationApplied).length /
      mmwaveAnalyses.length
    : 1;
  const calibrationQualities = analyses.flatMap(({ rxCalibrationQualityScore }) =>
    rxCalibrationQualityScore === undefined ? [] : [rxCalibrationQualityScore],
  );
  const calibrationQuality = calibrationQualities.length
    ? mean(calibrationQualities)
    : mmwaveAnalyses.length
      ? 0
      : 100;
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

  const timedFrames = frames.filter(
    ({ timing }) =>
      timing?.monotonicTimestampNs && timing.timestampSource !== 'legacy-wall-clock',
  );
  const timingCoverage = timedFrames.length / frames.length;
  const clockDomains = new Set(timedFrames.map(({ timing }) => timing!.clockDomain));
  const timingUncertaintiesMs = timedFrames.map(
    ({ timing }) => timing!.uncertaintyNs / 1_000_000,
  );
  const averageTimingUncertaintyMs = timingUncertaintiesMs.length
    ? mean(timingUncertaintiesMs)
    : Number.POSITIVE_INFINITY;
  const maximumTimingUncertaintyMs = timingUncertaintiesMs.length
    ? Math.max(...timingUncertaintiesMs)
    : Number.POSITIVE_INFINITY;
  const physicalCapture = frames.some(({ isSimulated }) => !isSimulated);

  const metrics: ScannerSignalQualityGate['metrics'] = [
    {
      id: 'raw-cube-preservation',
      label: 'Rå radarkub',
      value: rawCubeRatio * 100,
      unit: '%',
      score: rawCubeRatio,
      passed: rawCubeRatio >= 0.98,
      blocking: mmwaveFrames.length > 0 && rawCubeRatio < 0.9,
      detail: `${(rawCubeRatio * 100).toFixed(1)}% bevarar RX × chirp × ADC.`,
    },
    {
      id: 'rx-calibration',
      label: 'RX gain/faskalibrering',
      value: calibrationQuality,
      unit: 'poäng',
      score: clamp(calibrationQuality / 100) * calibrationCoverage,
      passed: calibrationCoverage >= 0.98 && calibrationQuality >= 60,
      blocking:
        mmwaveAnalyses.length > 0 &&
        (calibrationCoverage < 0.9 || calibrationQuality < 40),
      detail: `${(calibrationCoverage * 100).toFixed(1)}% kalibrerade frames, kvalitet ${calibrationQuality.toFixed(0)}/100.`,
    },
    {
      id: 'monotonic-clock',
      label: 'Monoton mätklocka',
      value: timingCoverage * 100,
      unit: '%',
      score: timingCoverage * (clockDomains.size === 1 ? 1 : 0.25),
      passed: timingCoverage >= 0.98 && clockDomains.size === 1,
      blocking: physicalCapture && (timingCoverage < 0.9 || clockDomains.size !== 1),
      detail: `${(timingCoverage * 100).toFixed(1)}% frames i ${clockDomains.size} klockdomän(er).`,
    },
    {
      id: 'timestamp-uncertainty',
      label: 'Tidsosäkerhet',
      value: averageTimingUncertaintyMs,
      unit: 'ms',
      score: Number.isFinite(averageTimingUncertaintyMs)
        ? clamp(1 - averageTimingUncertaintyMs / 20)
        : 0,
      passed: averageTimingUncertaintyMs <= 5 && maximumTimingUncertaintyMs <= 10,
      blocking: physicalCapture && maximumTimingUncertaintyMs > 25,
      detail: Number.isFinite(averageTimingUncertaintyMs)
        ? `${averageTimingUncertaintyMs.toFixed(2)} ms i snitt, ${maximumTimingUncertaintyMs.toFixed(2)} ms max.`
        : 'Tidsosäkerhet saknas.',
    },
    {
      id: 'packet-integrity',
      label: 'Paketintegritet',
      value: sequenceGaps,
      unit: 'luckor',
      score: clamp(1 - sequenceGaps / Math.max(1, frames.length * 0.03)),
      passed: sequenceGaps <= Math.max(1, frames.length * 0.01),
      blocking: sequenceGaps > Math.max(4, frames.length * 0.05),
      detail: `${sequenceGaps} saknade, dubbla eller felordnade sekvenser.`,
    },
    {
      id: 'signal-to-noise',
      label: 'Signal–brusförhållande',
      value: averageSnr,
      unit: 'dB',
      score: clamp((averageSnr - 3) / 17),
      passed: averageSnr >= 9,
      blocking: averageSnr < 3,
      detail: `${averageSnr.toFixed(1)} dB i genomsnitt.`,
    },
    {
      id: 'chirp-coherence',
      label: 'Chirpkoherens',
      value: averageChirpCoherence * 100,
      unit: '%',
      score: clamp((averageChirpCoherence - 0.2) / 0.65),
      passed: averageChirpCoherence >= 0.55,
      blocking: chirpCoherences.length > 0 && averageChirpCoherence < 0.2,
      detail: `${(averageChirpCoherence * 100).toFixed(1)}% fasöverensstämmelse inom frames.`,
    },
    {
      id: 'rx-coherence',
      label: 'RX-koherens efter kalibrering',
      value: averageRxCoherence * 100,
      unit: '%',
      score: clamp((averageRxCoherence - 0.1) / 0.75),
      passed: averageRxCoherence >= 0.55,
      blocking: false,
      detail: `${(averageRxCoherence * 100).toFixed(1)}% överensstämmelse mellan RX-kanaler.`,
    },
    {
      id: 'target-confidence',
      label: 'Målförtroende',
      value: averageTargetConfidence * 100,
      unit: '%',
      score: clamp((averageTargetConfidence - 0.2) / 0.65),
      passed: averageTargetConfidence >= 0.55,
      blocking: averageTargetConfidence < 0.2,
      detail: `${(averageTargetConfidence * 100).toFixed(1)}% kombinerat stöd.`,
    },
    {
      id: 'frame-timing',
      label: 'Frameintervall',
      value: timingVariation * 100,
      unit: '% CV',
      score: clamp(1 - timingVariation / 0.2),
      passed: timingVariation <= 0.08 && intervalCount >= frames.length - 3,
      blocking: timingVariation > 0.35 || intervalCount < frames.length - 3,
      detail: `${(timingVariation * 100).toFixed(1)}% variation mellan frames.`,
    },
    {
      id: 'range-stability',
      label: 'Range-stabilitet',
      value: rangeDeviation * 1000,
      unit: 'mm',
      score: clamp(1 - rangeDeviation / 0.03),
      passed: rangeDeviation <= 0.01,
      blocking: rangeDeviation > 0.05,
      detail: `${(rangeDeviation * 1000).toFixed(1)} mm standardavvikelse.`,
    },
    {
      id: 'target-stability',
      label: 'Målbin-stabilitet',
      value: targetBinDeviation,
      unit: 'bin',
      score: clamp(1 - targetBinDeviation / 2.5),
      passed: targetBinDeviation <= 0.75,
      blocking: targetBinDeviation > 4,
      detail: `${targetBinDeviation.toFixed(2)} bins standardavvikelse.`,
    },
    {
      id: 'phase-continuity',
      label: 'Faskontinuitet',
      value: phaseJumpRatio * 100,
      unit: '% glapp',
      score: clamp(1 - phaseJumpRatio / 0.25),
      passed: phaseJumpRatio <= 0.08,
      blocking: phaseJumpRatio > 0.4,
      detail: `${(phaseJumpRatio * 100).toFixed(1)}% stora fassteg.`,
    },
    {
      id: 'device-motion',
      label: 'Scanner-rörelse',
      value: motionRatio * 100,
      unit: '% frames',
      score: clamp(1 - motionRatio / 0.2),
      passed: motionRatio <= 0.05,
      blocking: motionRatio > 0.35,
      detail: `${(motionRatio * 100).toFixed(1)}% rörelsekontaminerade frames.`,
    },
    {
      id: 'usable-frames',
      label: 'Användbara frames',
      value: usableFrameRatio * 100,
      unit: '%',
      score: clamp((usableFrameRatio - 0.35) / 0.55),
      passed: usableFrameRatio >= 0.8,
      blocking: usableFrameRatio < 0.35,
      detail: `${(usableFrameRatio * 100).toFixed(1)}% uppfyller minimikraven.`,
    },
    {
      id: 'duration',
      label: 'Mätlängd',
      value: durationSeconds,
      unit: 's',
      score: clamp(durationSeconds / 8),
      passed: durationSeconds >= 8,
      blocking: durationSeconds < 1.5,
      detail: `${durationSeconds.toFixed(1)} sekunder analyserbar data.`,
    },
  ];

  const weights: Record<string, number> = {
    'raw-cube-preservation': 0.08,
    'rx-calibration': 0.11,
    'monotonic-clock': 0.08,
    'timestamp-uncertainty': 0.06,
    'packet-integrity': 0.05,
    'signal-to-noise': 0.12,
    'chirp-coherence': 0.1,
    'rx-coherence': 0.06,
    'target-confidence': 0.09,
    'frame-timing': 0.06,
    'range-stability': 0.06,
    'target-stability': 0.04,
    'phase-continuity': 0.05,
    'device-motion': 0.04,
    'usable-frames': 0.03,
    duration: 0.02,
  };
  const score = Math.round(
    100 * metrics.reduce((sum, metric) => sum + metric.score * (weights[metric.id] ?? 0), 0),
  );
  const blocking = metrics.filter(({ blocking }) => blocking);
  const failed = metrics.filter(({ passed }) => !passed);
  let verdict: ScannerSignalQualityGate['verdict'];
  if (blocking.length || score < 45) verdict = 'rejected';
  else if (failed.length || score < 75) verdict = 'repeat';
  else verdict = 'approved';

  return {
    version: 'scanner-quality-v3',
    evaluatedAt: new Date().toISOString(),
    verdict,
    score,
    usableFrameRatio,
    estimatedFrameRateHz: frameRateHz,
    durationSeconds,
    metrics,
    reasons: failed.map(({ label, detail }) => `${label}: ${detail}`),
    recommendedAction:
      verdict === 'approved'
        ? 'Mätningen är tekniskt godkänd för kalibrerad forskningsanalys.'
        : verdict === 'repeat'
          ? 'Upprepa mätningen och förbättra kalibrering, placering eller tidssynkronisering.'
          : 'Resultatet ska inte tolkas. Kontrollera råkub, RX-kalibrering, klocka och signal.',
  };
}
