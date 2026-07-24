import { requireNativeModule } from 'expo-modules-core';

import type { ScanItHealthKitNativeModule } from './ScanItHealthKit.types';

export default requireNativeModule<ScanItHealthKitNativeModule>('ScanItHealthKit');
