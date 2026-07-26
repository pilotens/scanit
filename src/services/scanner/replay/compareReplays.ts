import type {
  ScannerComparisonResult,
  ScannerReplayResult,
} from '@/domain/scannerLab';

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
  return denominator > 0
    ? Math.max(-1, Math.min(1, dot / denominator))
    : 0;
};

export function compareScannerReplays(
  reference: ScannerReplayResult,
  candidate: ScannerReplayResult,
): ScannerComparisonResult {
  const profileCosineSimilarity = cosineSimilarity(
    reference.profile,
    candidate.profile,
  );
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
  if (
    reference.manifest.hardwareProfileId !==
    candidate.manifest.hardwareProfileId
  ) {
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
  if (
    reference.calibration.rxCalibration?.version !==
    candidate.calibration.rxCalibration?.version
  ) {
    warnings.push('Inspelningarna saknar jämförbar RX-kalibrering.');
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
