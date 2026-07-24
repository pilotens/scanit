import type { VitalSnapshot } from './health';

export const CURRENT_CONSENT_VERSION = '2026-07-24-v1';

export type UserProfile = {
  id: string;
  displayName?: string;
  birthYear?: number;
  createdAt: string;
  updatedAt: string;
};

export type ConsentRecord = {
  version: typeof CURRENT_CONSENT_VERSION;
  acceptedAt: string;
  researchPrototypeAccepted: boolean;
  encryptedLocalStorageAccepted: boolean;
  healthKitReadAccepted: boolean;
};

export type HealthKitConnectionStatus =
  | 'unsupported'
  | 'idle'
  | 'authorizing'
  | 'importing'
  | 'ready'
  | 'error';

export type HealthKitEcgSummary = {
  id: string;
  startDate: string;
  endDate: string;
  classification:
    | 'sinus-rhythm'
    | 'atrial-fibrillation'
    | 'inconclusive-high-heart-rate'
    | 'inconclusive-low-heart-rate'
    | 'inconclusive-poor-reading'
    | 'inconclusive-other'
    | 'unrecognized'
    | 'not-set';
  symptomsStatus: 'none' | 'present' | 'not-set';
  averageHeartRateBpm?: number;
  samplingFrequencyHz?: number;
  voltageMeasurementCount: number;
  algorithmVersion?: number;
  sourceName: string;
  sourceBundleIdentifier: string;
  deviceName?: string;
};

export type HealthKitImportRecord = {
  schemaVersion: 1;
  importedAt: string;
  authorizationRequested: boolean;
  vitalSnapshot: VitalSnapshot;
  electrocardiograms: HealthKitEcgSummary[];
  sourceTypes: string[];
};
