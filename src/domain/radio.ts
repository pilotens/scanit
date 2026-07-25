import type { RfPosition } from './scanning';
import type { ScannerFrameTiming } from './scannerTiming';

export type RadioModality =
  | 'mmwave-fmcw'
  | 'uwb-impulse'
  | 'wifi-csi'
  | 'bluetooth-channel-sounding';

export type ScannerTransportKind = 'usb' | 'wifi' | 'bluetooth' | 'memory';
export type RadioSampleFormat = 'complex-iq-f32' | 'real-adc-in-iq-container';
export type RadioDataLayout = 'channel-sample' | 'rx-chirp-sample';

export type Vector3 = {
  x: number;
  y: number;
  z: number;
};

export type RawRadioFrame = {
  frameId: string;
  sessionId: string;
  sequence: number;
  /** Canonical scanner-clock timestamp. Legacy recordings may still contain wall-clock nanoseconds. */
  timestampNs: string;
  timing?: ScannerFrameTiming;
  modality: RadioModality;
  position: RfPosition;
  centerFrequencyHz: number;
  bandwidthHz: number;
  sampleRateHz: number;
  channels: number;
  /** Total complex-container points per channel. For a cube this is chirps × samples per chirp. */
  samplesPerChannel: number;
  sampleFormat?: RadioSampleFormat;
  dataLayout?: RadioDataLayout;
  /** Channel-major interleaved container: [I0, Q0, I1, Q1, ...]. Real ADC frames use Q=0 explicitly. */
  samples: number[];
  antennaConfigurationId: string;
  calibrationId?: string;
  acquisition?: {
    source: string;
    frameRateHz?: number;
    frameRepetitionTimeSeconds?: number;
    chirpsPerFrame?: number;
    chirpRepetitionTimeSeconds?: number;
    samplesPerChirp?: number;
    rxMask?: number;
    txMask?: number;
    rawCubeShape?: number[];
    chirpReduction?: 'none' | 'mean' | string;
    adcSignalType?: 'real' | 'complex';
  };
  deviceTemperatureCelsius?: number;
  imu?: {
    acceleration: Vector3;
    angularVelocity: Vector3;
  };
  qualityFlags: string[];
  isSimulated: boolean;
};

export type ScannerRxCalibrationChannel = {
  channel: number;
  gainCorrection: number;
  phaseCorrectionRadians: number;
  measuredMagnitude: number;
  measuredPhaseRadians: number;
  amplitudeCoefficientOfVariation: number;
  phaseStandardDeviationRadians: number;
  valid: boolean;
};

export type ScannerRxCalibration = {
  version: 'scanner-rx-calibration-v1';
  createdAt: string;
  hardwareProfileId: string;
  antennaConfigurationId: string;
  frameCount: number;
  referenceRxChannel: number;
  targetBin: number;
  targetRangeMeters?: number;
  channels: ScannerRxCalibrationChannel[];
  coherenceBefore: number;
  coherenceAfter: number;
  qualityScore: number;
  deviceTemperatureCelsius?: number;
  qualityFlags: string[];
};

export type ScannerCalibration = {
  id: string;
  modality: RadioModality;
  createdAt: string;
  position: RfPosition;
  frameCount: number;
  profile: number[];
  noiseFloor: number;
  hardwareProfileId: string;
  rxCalibration?: ScannerRxCalibration;
};

export type ScannerFrameAnalysis = {
  sequence: number;
  modality: RadioModality;
  targetBin: number;
  targetRangeMeters?: number;
  normalizedProfile: number[];
  baselineDeltaProfile: number[];
  phaseRadians?: number;
  phaseDeltaRadians?: number;
  displacementMillimeters?: number;
  motionScore: number;
  signalToNoiseRatioDb: number;
  signalQuality: 'poor' | 'fair' | 'good' | 'excellent';
  qualityFlags: string[];
  rxCoherence?: number;
  rxCoherenceBeforeCalibration?: number;
  chirpCoherence?: number;
  targetConfidence?: number;
  targetBinTracked?: boolean;
  rxCalibrationApplied?: boolean;
  rxCalibrationQualityScore?: number;
  timingUncertaintyMilliseconds?: number;
};

export type ScannerHardwareProfile = {
  id: string;
  name: string;
  modality: RadioModality;
  transport: ScannerTransportKind[];
  rawDataAccess: boolean;
  channels: number;
  frequencyRange: string;
  role: 'mechanical-heart-sensing' | 'tissue-response' | 'experimental-channel-sensing';
  maturity: 'selected-poc' | 'secondary-poc' | 'research-track';
  strengths: string[];
  limitations: string[];
};

export type ScannerCoreDiagnostic = {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  targetRangeMeters: number;
  peakDisplacementMillimeters: number;
  averageSignalToNoiseRatioDb: number;
  profile: number[];
};
