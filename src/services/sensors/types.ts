import type { VitalSnapshot } from '@/domain/health';
import type { RfObservation, RfPosition } from '@/domain/scanning';

export type SensorHealth = {
  connected: boolean;
  batteryPercent?: number;
  lastSeenAt: string;
};

export interface WearableSensorProvider {
  readonly id: string;
  connect(): Promise<SensorHealth>;
  readSnapshot(): Promise<VitalSnapshot>;
  collectBaselineWindow(durationMs: number): Promise<VitalSnapshot>;
}

export interface RfScannerProvider {
  readonly id: string;
  connect(): Promise<SensorHealth>;
  calibrate(): Promise<void>;
  scanPosition(position: RfPosition, durationMs: number): Promise<RfObservation>;
  disconnect?(): void | Promise<void>;
}
