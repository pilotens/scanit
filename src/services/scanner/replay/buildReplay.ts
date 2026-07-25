import type { ScannerFrameAnalysis } from '@/domain/radio';
import type {
  ScannerRecording,
  ScannerReplayOptions,
  ScannerReplayResult,
} from '@/domain/scannerLab';

import { interpretScannerEvidence } from '../interpretation/evidenceEngine';
import { buildEventLockedCoherentAverage } from '../processing/coherentAveraging';
import { separateScannerPhysiology } from '../processing/physiology';
import { ScannerSignalPipeline } from '../processing/pipeline';
import { trackScannerTarget } from '../processing/targetTracking';
import { evaluateScannerSignalQuality } from '../quality/signalQualityEngine';
import { buildScannerClockModel } from '../timing/clockModel';

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const standardDeviation = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

const qualityRank: Record<ScannerFrameAnalysis['signalQuality'], number> = {
  poor: 0,
  fair: 1,
  good: 2,
  excellent: 3,
};

const rankToQuality = (rank: number): ScannerFrameAnalysis['signalQuality'] => {
  if (rank >= 2.5) return 'excellent';
  if (rank >= 1.5) return 'good';
  if (rank >= 0.5) return 'fair';
  return 'poor';
};

export function buildScannerReplay(
  recording: ScannerRecording,
  options: ScannerReplayOptions = {},
): ScannerReplayResult {
  const { manifest, frames } = recording;
  const calibrationCount = Math.max(
    4,
    Math.min(manifest.calibrationFrameCount, frames.length - 2),
  );
  const pipeline = new ScannerSignalPipeline();
  const calibration = pipeline.calibrate(
    frames.slice(0, calibrationCount),
    manifest.hardwareProfileId,
  );
  const activeFrames = frames.slice(calibrationCount);
  const targetTrack = trackScannerTarget(activeFrames);
  const analyses = activeFrames.map((frame, index) => ({
    frame,
    analysis: pipeline.process(frame, targetTrack.bins[index]),
  }));
  if (!analyses.length) throw new Error('Recording contains no frames after calibration.');

  const analysisValues = analyses.map(({ analysis }) => analysis);
  const qualityGate = evaluateScannerSignalQuality(activeFrames, analysisValues);
  const physiology = separateScannerPhysiology(
    activeFrames,
    qualityGate,
    calibration.rxCalibration,
  );
  const clockModel = buildScannerClockModel(activeFrames);
  const coherentAverage = options.referenceEvents?.length
    ? buildEventLockedCoherentAverage({
        frames: activeFrames,
        analyses: analysisValues,
        referenceEvents: options.referenceEvents,
        clockModel,
        qualityGate,
      })
    : undefined;
  const interpretation = interpretScannerEvidence({
    frames: activeFrames,
    analyses: analysisValues,
    qualityGate,
    physiology,
    targetTrack,
  });

  const ranges = analyses.flatMap(({ analysis }) =>
    analysis.targetRangeMeters === undefined ? [] : [analysis.targetRangeMeters],
  );
  const displacements = analyses.flatMap(({ analysis }) =>
    analysis.displacementMillimeters === undefined
      ? []
      : [Math.abs(analysis.displacementMillimeters)],
  );
  const chirpCoherences = analyses.flatMap(({ analysis }) =>
    analysis.chirpCoherence === undefined ? [] : [analysis.chirpCoherence],
  );
  const rxCoherences = analyses.flatMap(({ analysis }) =>
    analysis.rxCoherence === undefined ? [] : [analysis.rxCoherence],
  );
  const rxCoherencesBeforeCalibration = analyses.flatMap(({ analysis }) =>
    analysis.rxCoherenceBeforeCalibration === undefined
      ? []
      : [analysis.rxCoherenceBeforeCalibration],
  );
  const targetConfidences = analyses.flatMap(({ analysis }) =>
    analysis.targetConfidence === undefined ? [] : [analysis.targetConfidence],
  );
  const qualityFlags = [
    ...new Set([
      ...analyses.flatMap(({ analysis }) => analysis.qualityFlags),
      ...physiology.qualityFlags,
      ...targetTrack.qualityFlags,
      ...(calibration.rxCalibration?.qualityFlags ?? []),
      ...(clockModel.status === 'synchronized' ? [] : [`clock-${clockModel.status}`]),
    ]),
  ];
  const averageQuality = mean(
    analyses.map(({ analysis }) => qualityRank[analysis.signalQuality]),
  );

  return {
    recordingId: manifest.id,
    processedAt: new Date().toISOString(),
    processingVersion: 'scanner-pipeline-v4',
    manifest,
    calibration,
    samples: analyses.map(({ frame, analysis }) => ({
      sequence: frame.sequence,
      timestampNs: frame.timestampNs,
      phaseRadians: analysis.phaseRadians,
      targetRangeMeters: analysis.targetRangeMeters,
      displacementMillimeters: analysis.displacementMillimeters,
      signalToNoiseRatioDb: analysis.signalToNoiseRatioDb,
      signalQuality: analysis.signalQuality,
      motionScore: analysis.motionScore,
      qualityFlags: analysis.qualityFlags,
      chirpCoherence: analysis.chirpCoherence,
      rxCoherence: analysis.rxCoherence,
      rxCoherenceBeforeCalibration: analysis.rxCoherenceBeforeCalibration,
      targetConfidence: analysis.targetConfidence,
      rxCalibrationApplied: analysis.rxCalibrationApplied,
      timingUncertaintyMilliseconds: analysis.timingUncertaintyMilliseconds,
    })),
    profile: analyses.at(-1)!.analysis.normalizedProfile,
    qualityGate,
    physiology,
    targetTracking: {
      medianBin: targetTrack.medianBin,
      medianRangeMeters: targetTrack.medianRangeMeters,
      confidence: targetTrack.confidence,
      binStandardDeviation: targetTrack.binStandardDeviation,
      rangeGateMinimumMeters: targetTrack.rangeGate.minimumMeters,
      rangeGateMaximumMeters: targetTrack.rangeGate.maximumMeters,
      qualityFlags: targetTrack.qualityFlags,
    },
    interpretation,
    clockModel,
    coherentAverage,
    summary: {
      processedFrameCount: analyses.length,
      averageSignalToNoiseRatioDb: mean(
        analyses.map(({ analysis }) => analysis.signalToNoiseRatioDb),
      ),
      peakDisplacementMillimeters: Math.max(...displacements, 0),
      averageTargetRangeMeters: ranges.length ? mean(ranges) : undefined,
      rangeStandardDeviationMeters: ranges.length
        ? standardDeviation(ranges)
        : undefined,
      averageMotionScore: mean(
        analyses.map(({ analysis }) => analysis.motionScore),
      ),
      averageChirpCoherence: chirpCoherences.length
        ? mean(chirpCoherences)
        : undefined,
      averageRxCoherence: rxCoherences.length
        ? mean(rxCoherences)
        : undefined,
      averageRxCoherenceBeforeCalibration: rxCoherencesBeforeCalibration.length
        ? mean(rxCoherencesBeforeCalibration)
        : undefined,
      averageTargetConfidence: targetConfidences.length
        ? mean(targetConfidences)
        : undefined,
      dominantSignalQuality: rankToQuality(averageQuality),
      qualityFlags,
    },
  };
}
