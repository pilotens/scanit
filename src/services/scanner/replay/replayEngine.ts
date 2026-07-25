import type { ScannerFrameAnalysis } from '@/domain/radio';
import type {
  ScannerComparisonResult,
  ScannerRecording,
  ScannerReplayResult,
} from '@/domain/scannerLab';

import { interpretScannerEvidence } from '../interpretation/evidenceEngine';
import { separateScannerPhysiology } from '../processing/physiology';
import { ScannerSignalPipeline } from '../processing/pipeline';
import { trackScannerTarget } from '../processing/targetTracking';
import { evaluateScannerSignalQuality } from '../quality/signalQualityEngine';

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

export function replayScannerRecording(recording: ScannerRecording): ScannerReplayResult {
  const { manifest, frames } = recording;
  const calibrationCount = Math.max(4, Math.min(manifest.calibrationFrameCount, frames.length - 2));
  const pipeline = new ScannerSignalPipeline();
  const calibration = pipeline.calibrate(frames.slice(0, calibrationCount), manifest.hardwareProfileId);
  const activeFrames = frames.slice(calibrationCount);
  const targetTrack = trackScannerTarget(activeFrames);
  const analyses = activeFrames.map((frame, index) => ({
    frame,
    analysis: pipeline.process(frame, targetTrack.bins[index]),
  }));
  if (!analyses.length) throw new Error('Recording contains no frames after calibration.');

  const analysisValues = analyses.map(({ analysis }) => analysis);
  const qualityGate = evaluateScannerSignalQuality(activeFrames, analysisValues);
  const physiology = separateScannerPhysiology(activeFrames, qualityGate);
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
    analysis.displacementMillimeters === undefined ? [] : [Math.abs(analysis.displacementMillimeters)],
  );
  const chirpCoherences = analyses.flatMap(({ analysis }) =>
    analysis.chirpCoherence === undefined ? [] : [analysis.chirpCoherence],
  );
  const rxCoherences = analyses.flatMap(({ analysis }) =>
    analysis.rxCoherence === undefined ? [] : [analysis.rxCoherence],
  );
  const targetConfidences = analyses.flatMap(({ analysis }) =>
    analysis.targetConfidence === undefined ? [] : [analysis.targetConfidence],
  );
  const qualityFlags = [
    ...new Set([
      ...analyses.flatMap(({ analysis }) => analysis.qualityFlags),
      ...physiology.qualityFlags,
      ...targetTrack.qualityFlags,
    ]),
  ];
  const averageQuality = mean(analyses.map(({ analysis }) => qualityRank[analysis.signalQuality]));

  return {
    recordingId: manifest.id,
    processedAt: new Date().toISOString(),
    processingVersion: 'scanner-pipeline-v3',
    manifest,
    calibration,
    samples: analyses.map(({ frame, analysis }) => ({
      sequence: frame.sequence,
      timestampNs: frame.timestampNs,
      targetRangeMeters: analysis.targetRangeMeters,
      displacementMillimeters: analysis.displacementMillimeters,
      signalToNoiseRatioDb: analysis.signalToNoiseRatioDb,
      signalQuality: analysis.signalQuality,
      motionScore: analysis.motionScore,
      qualityFlags: analysis.qualityFlags,
      chirpCoherence: analysis.chirpCoherence,
      rxCoherence: analysis.rxCoherence,
      targetConfidence: analysis.targetConfidence,
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
    summary: {
      processedFrameCount: analyses.length,
      averageSignalToNoiseRatioDb: mean(
        analyses.map(({ analysis }) => analysis.signalToNoiseRatioDb),
      ),
      peakDisplacementMillimeters: Math.max(...displacements, 0),
      averageTargetRangeMeters: ranges.length ? mean(ranges) : undefined,
      rangeStandardDeviationMeters: ranges.length ? standardDeviation(ranges) : undefined,
      averageMotionScore: mean(analyses.map(({ analysis }) => analysis.motionScore)),
      averageChirpCoherence: chirpCoherences.length ? mean(chirpCoherences) : undefined,
      averageRxCoherence: rxCoherences.length ? mean(rxCoherences) : undefined,
      averageTargetConfidence: targetConfidences.length ? mean(targetConfidences) : undefined,
      dominantSignalQuality: rankToQuality(averageQuality),
      qualityFlags,
    },
  };
}

const cosineSimilarity = (left: number[], right: number[]) => {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue ** 2;
    rightNorm += rightValue ** 2;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator > 0 ? Math.max(-1, Math.min(1, dot / denominator)) : 0;
};

export function compareScannerReplays(
  reference: ScannerReplayResult,
  candidate: ScannerReplayResult,
): ScannerComparisonResult {
  const profileCosineSimilarity = cosineSimilarity(reference.profile, candidate.profile);
  const referenceRange = reference.summary.averageTargetRangeMeters;
  const candidateRange = candidate.summary.averageTargetRangeMeters;
  const averageRangeShiftMillimeters =
    referenceRange !== undefined && candidateRange !== undefined
      ? Math.abs(candidateRange - referenceRange) * 1000
      : undefined;
  const peakDisplacementDifferenceMillimeters = Math.abs(
    candidate.summary.peakDisplacementMillimeters -
      reference.summary.peakDisplacementMillimeters,
  );
  const averageSnrDifferenceDb =
    candidate.summary.averageSignalToNoiseRatioDb -
    reference.summary.averageSignalToNoiseRatioDb;
  const warnings: string[] = [];
  if (reference.manifest.position !== candidate.manifest.position) {
    warnings.push('Inspelningarna kommer från olika scannerpositioner.');
  }
  if (reference.manifest.hardwareProfileId !== candidate.manifest.hardwareProfileId) {
    warnings.push('Inspelningarna använder olika hårdvaruprofiler.');
  }
  if (reference.manifest.modality !== candidate.manifest.modality) {
    warnings.push('Inspelningarna använder olika radiotekniker.');
  }
  if (reference.qualityGate.verdict !== 'approved') {
    warnings.push('Referensmätningens signalkvalitet är inte godkänd.');
  }
  if (candidate.qualityGate.verdict !== 'approved') {
    warnings.push('Kandidatmätningens signalkvalitet är inte godkänd.');
  }

  const rangeShift = averageRangeShiftMillimeters ?? 0;
  let classification: ScannerComparisonResult['classification'];
  if (
    reference.qualityGate.verdict !== 'approved' ||
    candidate.qualityGate.verdict !== 'approved'
  ) {
    classification = 'insufficient-quality';
  } else if (
    profileCosineSimilarity < 0.82 ||
    rangeShift > 30 ||
    peakDisplacementDifferenceMillimeters > 1
  ) {
    classification = 'significant-change';
  } else if (
    profileCosineSimilarity < 0.94 ||
    rangeShift > 10 ||
    peakDisplacementDifferenceMillimeters > 0.35
  ) {
    classification = 'changed';
  } else {
    classification = 'stable';
  }

  return {
    referenceRecordingId: reference.recordingId,
    candidateRecordingId: candidate.recordingId,
    profileCosineSimilarity,
    averageRangeShiftMillimeters,
    peakDisplacementDifferenceMillimeters,
    averageSnrDifferenceDb,
    classification,
    warnings,
  };
}
