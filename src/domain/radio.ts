import type { RfPosition } from './scanning';

export type RadioModality =
  | 'mmwave-fmcw'
  | 'uwb-impulse'
  | 'wifi-csi'
  | 'bluetooth-channel-sounding';

export type ScannerTransportKind = 'usb' | 'wifi' | 'bluetooth' | 'memory';

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
  modality: RadioModality;
  position: RfPosition;
  centerFrequencyHz: number;
  bandwidthHz: number;
  sampleRateHz: number;
  channels: number;
  samplesPerChannel: number;
  /** Channel-major interleaved IQ: [I0, Q0, I1, Q1, ...]. */
  samples: number[];
  antennaConfigurationId: string;
  calibrationId?: string;
  deviceTemperatureCelsius?: number;
  imu?: {
    acceleration: Vector3;
    angularVelocity: Vector3;
  };
  qualityFlags: string[];
  isSimulated: boolean;
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
