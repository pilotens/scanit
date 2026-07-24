import type { RfObservation, RfPosition } from '@/domain/scanning';
import type { RfScannerProvider } from './types';

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs));

const positionOffset: Record<RfPosition, number> = {
  'left-sternal': 0.06,
  apex: 0.12,
  'right-reference': -0.03,
  'upper-chest': 0.02,
};

export class MockRfScannerProvider implements RfScannerProvider {
  readonly id = 'rf-demo';

  async connect() {
    await wait(300);
    return {
      connected: true,
      batteryPercent: 74,
      lastSeenAt: new Date().toISOString(),
    };
  }

  async calibrate() {
    await wait(1_000);
  }

  async scanPosition(position: RfPosition, durationMs: number): Promise<RfObservation> {
    await wait(Math.min(durationMs, 1_150));
    const offset = positionOffset[position];

    return {
      position,
      signalQuality: position === 'apex' ? 'excellent' : 'good',
      mechanicalRegularity: Math.max(0, Math.min(1, 0.91 - Math.abs(offset) * 0.2)),
      relativeReflectivity: 0.48 + offset,
      baselineDelta: Math.abs(offset) * 0.18,
      sampleCount: 768,
      isSimulated: true,
    };
  }
}
