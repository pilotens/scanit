import type {
  RadioModality,
  RawRadioFrame,
  ScannerCalibration,
  ScannerFrameAnalysis,
} from './radio';
import type { RfPosition } from './scanning';

export type ScannerLabSource = 'emulator' | 'gateway';

export type ScannerLabCaptureOptions = {
  label?: string;
  notes?: string[];
  tags?: string[];
  position: RfPosition;
  durationSeconds: number;
  targetFrameRateHz: number;
  calibrationFrames: number;
  maxFrames: number;
};

export type ScannerRecordingManifest = {
  schemaVersion: 1;
  id: string;
  label: string;
  createdAt: string;
  completedAt: string;
  source: ScannerLabSource;
  sourceDescriptor: string;
  modality: RadioModality;
  position: RfPosition;
  hardwareProfileId: string;
  protocolVersion: 1;
  processingVersion: 'scanner-pipeline-v1';
  frameCount: number;
  calibrationFrameCount: number;
  dataChunkCount: number;
  totalBytes: number;
  aggregateCrc32: string;
  firstTimestampNs: string;
  lastTimestampNs: string;
  estimatedFrameRateHz: number;
  sequenceGaps: number;
  qualityFlags: string[];
  tags: string[];
  notes: string[];
  isSimulated: boolean;
};

export type ScannerRecordingChunk = {
  schemaVersion: 1;
  recordingId: string;
  index: number;
  packetCount: number;
  packetsBase64: string[];
};

export type ScannerRecording = {
  manifest: ScannerRecordingManifest;
  frames: RawRadioFrame[];
};

export type ScannerReplaySample = {
  sequence: number;
  timestampNs: string;
  targetRangeMeters?: number;
  displacementMillimeters?: number;
  signalToNoiseRatioDb: number;
  signalQuality: ScannerFrameAnalysis['signalQuality'];
  motionScore: number;
  qualityFlags: string[];
};

export type ScannerReplayResult = {
  recordingId: string;
  processedAt: string;
  processingVersion: 'scanner-pipeline-v1';
  manifest: ScannerRecordingManifest;
  calibration: ScannerCalibration;
  samples: ScannerReplaySample[];
  profile: number[];
  summary: {
    processedFrameCount: number;
    averageSignalToNoiseRatioDb: number;
    peakDisplacementMillimeters: number;
    averageTargetRangeMeters?: number;
    rangeStandardDeviationMeters?: number;
    averageMotionScore: number;
    dominantSignalQuality: ScannerFrameAnalysis['signalQuality'];
    qualityFlags: string[];
  };
};

export type ScannerComparisonResult = {
  referenceRecordingId: string;
  candidateRecordingId: string;
  profileCosineSimilarity: number;
  averageRangeShiftMillimeters?: number;
  peakDisplacementDifferenceMillimeters: number;
  averageSnrDifferenceDb: number;
  classification: 'stable' | 'changed' | 'significant-change';
  warnings: string[];
};

export type ScannerLabProgress = {
  phase: 'connecting' | 'configuring' | 'capturing' | 'saving' | 'replaying' | 'completed';
  progress: number;
  message: string;
  framesCaptured: number;
  targetFrames: number;
};

export type ScannerLabCaptureResult = {
  manifest: ScannerRecordingManifest;
  replay: ScannerReplayResult;
};
