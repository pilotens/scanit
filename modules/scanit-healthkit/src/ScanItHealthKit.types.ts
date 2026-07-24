export type HealthKitAuthorizationResult = {
  requested: boolean;
  readTypes: string[];
};

export type HealthKitQuantitySample = {
  value: number;
  unit: string;
  startDate: string;
  endDate: string;
  sourceName: string;
  sourceBundleIdentifier: string;
  deviceName?: string;
};

export type HealthKitSnapshot = {
  importedAt: string;
  heartRate?: HealthKitQuantitySample;
  heartRateVariabilitySdnn?: HealthKitQuantitySample;
  oxygenSaturation?: HealthKitQuantitySample;
  sleepingWristTemperature?: HealthKitQuantitySample;
};

export type HealthKitEcgClassification =
  | 'sinus-rhythm'
  | 'atrial-fibrillation'
  | 'inconclusive-high-heart-rate'
  | 'inconclusive-low-heart-rate'
  | 'inconclusive-poor-reading'
  | 'inconclusive-other'
  | 'unrecognized'
  | 'not-set';

export type HealthKitEcgSymptomsStatus = 'none' | 'present' | 'not-set';

export type HealthKitElectrocardiogram = {
  id: string;
  startDate: string;
  endDate: string;
  classification: HealthKitEcgClassification;
  symptomsStatus: HealthKitEcgSymptomsStatus;
  averageHeartRateBpm?: number;
  samplingFrequencyHz?: number;
  voltageMeasurementCount: number;
  algorithmVersion?: number;
  sourceName: string;
  sourceBundleIdentifier: string;
  deviceName?: string;
};

export type ScanItHealthKitNativeModule = {
  isAvailable(): boolean;
  requestAuthorization(): Promise<HealthKitAuthorizationResult>;
  getLatestSnapshot(lookbackDays: number): Promise<HealthKitSnapshot>;
  getRecentElectrocardiograms(limit: number): Promise<HealthKitElectrocardiogram[]>;
};
