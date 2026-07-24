import type { VitalSnapshot } from '@/domain/health';

import type { WearableSensorProvider } from './types';

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs));

export class ImportedWearableProvider implements WearableSensorProvider {
  readonly id = 'apple-health-import';

  constructor(private readonly snapshot: VitalSnapshot) {}

  async connect() {
    await wait(100);
    return {
      connected: true,
      lastSeenAt: this.snapshot.timestamp,
    };
  }

  async readSnapshot() {
    return this.snapshot;
  }

  async collectBaselineWindow() {
    await wait(250);
    return this.snapshot;
  }
}
