import type { RfPosition } from './scanning';
import type { ScannerClockDescriptor } from './scannerTiming';

export type ScannerTrack = 'vital-motion' | 'microwave-tomography';

export type RadioModality =
  | 'mmwave-fmcw'
  | 'uwb-impulse'
  | 'wifi-csi'
  | 'bluetooth-channel-sounding'
  | 'microwave-tomography';

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
  timestampNs: string;
  timing?: ScannerClockDescriptor;
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
  amplitudeCoefficientOfVariation: number;
  phaseStandardDeviationRadians: number;
};

export type ScannerRxCalibration = {
  version: 'scanner-rx-calibration-v1';
  id: string;
  createdAt: string;
  hardwareProfileId: string;
  antennaConfigurationId: string;
  position: RfPosition;
  targetBin: number;
  targetRangeMeters?: number;
  referenceChannel: number;
  channels: ScannerRxCalibrationChannel[];
  frameCount: number;
  temperatureCelsius?: number;
  coherenceBefore: number;
  coherenceAfter: number;
  qualityScore: number;
  stable: boolean;
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
};

export type ScannerHardwareProfile = {
  id: string;
  name: string;
  track: ScannerTrack;
  modality: RadioModality;
  transport: ScannerTransportKind[];
  rawDataAccess: boolean;
  channels: number;
  frequencyRange: string;
  role:
    | 'mechanical-heart-sensing'
    | 'tissue-response'
    | 'experimental-channel-sensing'
    | 'multistatic-tomography';
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
