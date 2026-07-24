import type { ScanItHealthKitNativeModule } from './ScanItHealthKit.types';

const unavailable = () =>
  Promise.reject(new Error('HealthKit är endast tillgängligt i en signerad iOS-utvecklings- eller produktionsbuild.'));

const module: ScanItHealthKitNativeModule = {
  isAvailable: () => false,
  requestAuthorization: unavailable,
  getLatestSnapshot: unavailable,
  getRecentElectrocardiograms: unavailable,
};

export default module;
