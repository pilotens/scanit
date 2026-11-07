import type { ImagingMeasurement, Modality } from '@/domain/imaging';

export type ImagingCapability = {
  modality: Modality;
  available: boolean;
  simulated: boolean;
  detail?: string;
};

export type ImagingAcquisitionOptions = {
  durationMs: number;
  region: 'chest';
};

export interface ImagingSensorProvider {
  readonly id: string;
  connect(): Promise<void>;
  capabilities(): Promise<ImagingCapability[]>;
  calibrate(): Promise<void>;
  acquire(options: ImagingAcquisitionOptions): Promise<ImagingMeasurement[]>;
  disconnect(): Promise<void>;
}
