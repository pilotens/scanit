import type {
  ImagingAcquisitionOptions,
  ImagingCapability,
  ImagingSensorProvider,
} from '@/services/sensors/imagingProvider';
import { createSimulatedChestSweep } from '@/services/sensors/mockImagingScanner';

export class SimulatedMultimodalProvider implements ImagingSensorProvider {
  readonly id = 'simulated-multimodal-v1';

  async connect() {}

  async capabilities(): Promise<ImagingCapability[]> {
    return [
      { modality: 'ultrasound', available: true, simulated: true },
      { modality: 'microwave', available: true, simulated: true },
      { modality: 'uwb', available: true, simulated: true },
      { modality: 'imu', available: true, simulated: true, detail: 'Pose embedded in synthetic frames' },
    ];
  }

  async calibrate() {}

  async acquire(options: ImagingAcquisitionOptions) {
    if (options.region !== 'chest') throw new Error('Only chest phantom acquisition is implemented');
    return createSimulatedChestSweep();
  }

  async disconnect() {}
}
