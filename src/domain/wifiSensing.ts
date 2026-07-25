import type { ScannerClockDescriptor } from './scannerTiming';

export type WifiSensingBand = '2.4-ghz' | '5-ghz' | '6-ghz';
export type WifiSensingPhy = 'legacy-ofdm' | 'ht' | 'vht' | 'he' | 'eht' | 'unknown';

export type WifiCsiFrame = {
  schemaVersion: 1;
  frameId: string;
  sessionId: string;
  sequence: number;
  /** Same sounding packet across multiple receivers/antennas. */
  soundingSequence: number;
  timestampNs: string;
  timing?: ScannerClockDescriptor;
  txNodeId: string;
  rxNodeId: string;
  txAntenna: number;
  rxAntenna: number;
  band: WifiSensingBand;
  channel: number;
  centerFrequencyHz: number;
  bandwidthHz: number;
  phy: WifiSensingPhy;
  spatialStream: number;
  subcarrierIndices: number[];
  /** Interleaved complex CSI in subcarrier order: [real0, imag0, real1, imag1, ...]. */
  csi: number[];
  rssiDbm: number;
  noiseFloorDbm: number;
  packetSequence?: number;
  transmitterMac?: string;
  receiverMac?: string;
  calibrationId?: string;
  firmwareVersion: string;
  source: string;
  qualityFlags: string[];
  isSimulated: boolean;
};

export type WifiCsiLinkCorrection = {
  linkId: string;
  txNodeId: string;
  rxNodeId: string;
  txAntenna: number;
  rxAntenna: number;
  subcarrierIndices: number[];
  /** Complex baseline in the same interleaved layout as WifiCsiFrame.csi. */
  baselineCsi: number[];
  magnitudeCoefficientOfVariation: number;
  phaseResidualStandardDeviationRadians: number;
  valid: boolean;
};

export type WifiCsiCalibration = {
  version: 'wifi-csi-calibration-v1';
  id: string;
  createdAt: string;
  sessionId: string;
  packetCount: number;
  soundingCount: number;
  band: WifiSensingBand;
  channel: number;
  bandwidthHz: number;
  referenceLinkId: string;
  links: WifiCsiLinkCorrection[];
  qualityScore: number;
  qualityFlags: string[];
};

export type WifiSensingQualityMetric = {
  id: string;
  label: string;
  value: number;
  unit?: string;
  score: number;
  passed: boolean;
  blocking: boolean;
  detail: string;
};

export type WifiSensingQualityGate = {
  version: 'wifi-sensing-quality-v1';
  verdict: 'approved' | 'repeat' | 'rejected';
  score: number;
  estimatedSoundingRateHz: number;
  durationSeconds: number;
  pairedSoundingRatio: number;
  metrics: WifiSensingQualityMetric[];
  reasons: string[];
};

export type WifiSensingAnalysis = {
  version: 'wifi-csi-vitals-v1';
  sessionId: string;
  calibrationId: string;
  qualityGate: WifiSensingQualityGate;
  soundingCount: number;
  receiverLinkCount: number;
  selectedSubcarrierCount: number;
  relativePhaseTrace: number[];
  respirationTrace: number[];
  mechanicalTrace: number[];
  respiratoryRateBpm?: number;
  mechanicalRateBpm?: number;
  respirationConfidence: number;
  mechanicalConfidence: number;
  multipathStability: number;
  claims: Array<{
    id:
      | 'respiratory-periodicity'
      | 'mechanical-periodicity'
      | 'anatomy'
      | 'blood-flow'
      | 'coronary-artery'
      | 'stenosis'
      | 'ischemia-infarction';
    state: 'supported-as-engineering-signal' | 'experimental' | 'not-supported' | 'not-validated';
    explanation: string;
  }>;
  qualityFlags: string[];
};

export type WifiSensingCapture = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  completedAt: string;
  source: string;
  hardwareProfileId: string;
  frames: WifiCsiFrame[];
  calibrationSoundingCount: number;
  tags: string[];
  notes: string[];
};

export type WifiSensingRecordingManifest = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  completedAt: string;
  source: string;
  hardwareProfileId: string;
  frameCount: number;
  soundingCount: number;
  calibrationSoundingCount: number;
  chunkCount: number;
  totalBytes: number;
  aggregateCrc32: string;
  firstTimestampNs: string;
  lastTimestampNs: string;
  qualityFlags: string[];
  tags: string[];
  notes: string[];
  isSimulated: boolean;
};