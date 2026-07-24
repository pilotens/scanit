import ScanItHealthKitModule from './src/ScanItHealthKitModule';

export type {
  HealthKitAuthorizationResult,
  HealthKitEcgClassification,
  HealthKitEcgSymptomsStatus,
  HealthKitElectrocardiogram,
  HealthKitQuantitySample,
  HealthKitSnapshot,
} from './src/ScanItHealthKit.types';

export const isHealthDataAvailable = () => ScanItHealthKitModule.isAvailable();

export const requestHealthAuthorization = () =>
  ScanItHealthKitModule.requestAuthorization();

export const getLatestHealthSnapshot = (lookbackDays = 7) =>
  ScanItHealthKitModule.getLatestSnapshot(lookbackDays);

export const getRecentElectrocardiograms = (limit = 10) =>
  ScanItHealthKitModule.getRecentElectrocardiograms(limit);
