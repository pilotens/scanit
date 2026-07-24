import { currentVitals } from '@/data/mockData';
import type { WearableSensorProvider } from './types';

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs));

export class MockWearableProvider implements WearableSensorProvider {
  readonly id = 'wearable-demo';

  async connect() {
    await wait(250);
    return {
      connected: true,
      batteryPercent: 82,
      lastSeenAt: new Date().toISOString(),
    };
  }

  async readSnapshot() {
    await wait(300);
    return {
      ...currentVitals,
      timestamp: new Date().toISOString(),
    };
  }

  async collectBaselineWindow(durationMs: number) {
    await wait(Math.min(durationMs, 1_400));
    return {
      ...currentVitals,
      timestamp: new Date().toISOString(),
      heartRateBpm: 68,
      hrvRmssdMs: 43,
    };
  }
}
