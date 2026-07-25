import type { RadioModality, ScannerFrameAnalysis } from './radio';
import type { RfPosition } from './scanning';

export type ScannerQualityVerdict = 'approved' | 'repeat' | 'rejected';

export type ScannerQualityMetric = {
  id: string;
  label: string;
  value: number;
  unit?: string;
  score: number;
  passed: boolean;
  blocking: boolean;
  detail: string;
};

export type ScannerSignalQualityGate = {
  version: 'scanner-quality-v1' | 'scanner-quality-v2' | 'scanner-quality-v3';
  evaluatedAt: string;
  verdict: ScannerQualityVerdict;
  score: number;
  usableFrameRatio: number;
  estimatedFrameRateHz: number;
  durationSeconds: number;
  metrics: ScannerQualityMetric[];
  reasons: string[];
  recommendedAction: string;
};

export type ScannerPhysiologicalSeparation = {
  version: 'scanner-physiology-v1' | 'scanner-physiology-v2' | 'scanner-physiology-v3';
  reliable: boolean;
  frameRateHz: number;
  durationSeconds: number;
  respirationBin?: number;
  cardiacBin?: number;
  respirationRangeMeters?: number;
  cardiacRangeMeters?: number;
  respiratoryRateBpm?: number;
  cardiacMechanicalRateBpm?: number;
  cardiacAutocorrelationRateBpm?: number;
  respiratoryBandPower: number;
  cardiacBandPower: number;
  separationConfidence: number;
  spectralAutocorrelationAgreement?: number;
  respirationHarmonicRisk?: number;
  respirationTrace: number[];
  cardiacTrace: number[];
  qualityFlags: string[];
};

export type ScannerBaselineSource = {
  recordingId: string;
  createdAt: string;
  profile: number[];
  averageTargetRangeMeters?: number;
  peakDisplacementMillimeters: number;
  averageSignalToNoiseRatioDb: number;
  respiratoryRateBpm?: number;
  cardiacMechanicalRateBpm?: number;
  qualityScore: number;
};

export type ScannerPersonalBaseline = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  position: RfPosition;
  modality: RadioModality;
  hardwareProfileId: string;
  sourceCount: number;
  sourceRecordingIds: string[];
  profileMean: number[];
  averageTargetRangeMeters?: number;
  rangeStandardDeviationMeters?: number;
  peakDisplacementMeanMillimeters: number;
  peakDisplacementStandardDeviationMillimeters: number;
  averageSignalToNoiseRatioDb: number;
  cardiacMechanicalRateMeanBpm?: number;
  cardiacMechanicalRateStandardDeviationBpm?: number;
  sources: ScannerBaselineSource[];
};

export type ScannerBaselineComparison = {
  baselineId: string;
  candidateRecordingId: string;
  compatible: boolean;
  profileCosineSimilarity: number;
  rangeDeviationMillimeters?: number;
  peakDisplacementDeviationMillimeters: number;
  snrDeviationDb: number;
  cardiacRateDeviationBpm?: number;
  classification: 'within-baseline' | 'changed' | 'significant-change' | 'insufficient-quality';
  warnings: string[];
};

export type ScannerTargetTrackingSummary = {
  medianBin: number;
  medianRangeMeters?: number;
  confidence: number;
  binStandardDeviation: number;
  rangeGateMinimumMeters: number;
  rangeGateMaximumMeters: number;
  qualityFlags: string[];
};

export type ScannerAnalysisBundle = {
  analyses: ScannerFrameAnalysis[];
  qualityGate: ScannerSignalQualityGate;
  physiology: ScannerPhysiologicalSeparation;
  targetTracking?: ScannerTargetTrackingSummary;
};
