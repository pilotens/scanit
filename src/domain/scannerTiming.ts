export type ScannerTimestampSource =
  | 'gateway-monotonic-midpoint'
  | 'wifi-node-monotonic'
  | 'wifi-gateway-software-aligned'
  | 'synthetic-monotonic'
  | 'external-synchronized'
  | 'legacy-wall-clock';

export type ScannerFrameTiming = {
  /** Stable only within one gateway/device boot or one simulated session. */
  clockDomain: string;
  timestampSource: ScannerTimestampSource;
  /** Canonical acquisition timestamp in the scanner clock domain. */
  monotonicTimestampNs: string;
  /** Best wall-clock estimate for cross-device synchronization. */
  wallClockUnixNs?: string;
  /** Estimated ± uncertainty around the acquisition midpoint. */
  uncertaintyNs: number;
  acquisitionStartedMonotonicNs?: string;
  acquisitionEndedMonotonicNs?: string;
  anchorMonotonicNs?: string;
  anchorWallClockUnixNs?: string;
};

/** Shared name used by physical RF and Wi-Fi sensing frames. */
export type ScannerClockDescriptor = ScannerFrameTiming;

export type ScannerClockAnchor = {
  clockDomain: string;
  monotonicTimestampNs: string;
  wallClockUnixNs: string;
  uncertaintyNs: number;
};

export type ScannerClockModel = {
  version: 'scanner-clock-model-v1';
  status: 'synchronized' | 'degraded' | 'unavailable';
  clockDomain?: string;
  anchorCount: number;
  originMonotonicNs?: string;
  originWallClockUnixNs?: string;
  /** monotonic delta = wall-clock delta × slope */
  slope: number;
  driftPpm: number;
  rmsResidualNs: number;
  maximumAnchorUncertaintyNs: number;
  estimatedMappingUncertaintyNs: number;
  confidence: number;
  reasons: string[];
};

export type ScannerReferenceEvent = {
  id: string;
  source: 'ecg-r-peak' | 'ppg-pulse';
  /** Reference-device wall-clock timestamp. HealthKit summary timestamps are not sufficient. */
  timestampUnixNs: string;
  uncertaintyNs: number;
  quality: number;
  sourceDeviceId?: string;
};

export type ScannerMappedReferenceEvent = ScannerReferenceEvent & {
  scannerMonotonicTimestampNs: string;
  combinedUncertaintyNs: number;
};

export type ScannerCoherentAverage = {
  version: 'scanner-event-locked-average-v1';
  status:
    | 'available'
    | 'no-reference-events'
    | 'quality-rejected'
    | 'clock-unavailable'
    | 'timing-unreliable'
    | 'insufficient-events';
  referenceSource?: ScannerReferenceEvent['source'] | 'mixed';
  acceptedBeatCount: number;
  rejectedBeatCount: number;
  sampleOffsetsMilliseconds: number[];
  meanDisplacementMillimeters: number[];
  standardDeviationMillimeters: number[];
  standardErrorMillimeters: number[];
  beatCoherence: number;
  theoreticalCoherentGainDb: number;
  estimatedTimingUncertaintyMilliseconds: number;
  windowStartMilliseconds: number;
  windowEndMilliseconds: number;
  reasons: string[];
};
