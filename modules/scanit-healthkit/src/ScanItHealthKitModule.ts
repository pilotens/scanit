import { requireOptionalNativeModule } from 'expo-modules-core';

import type { ScanItHealthKitNativeModule } from './ScanItHealthKit.types';

const unavailable = () =>
  Promise.reject(
    new Error(
      'HealthKit-modulen saknas. Kör ScanIt i en signerad iOS-utvecklings- eller produktionsbuild.',
    ),
  );

const fallback: ScanItHealthKitNativeModule = {
  isAvailable: () => false,
  requestAuthorization: unavailable,
  getLatestSnapshot: unavailable,
  getRecentElectrocardiograms: unavailable,
};

export default requireOptionalNativeModule<ScanItHealthKitNativeModule>('ScanItHealthKit') ?? fallback;
