import type {
  TomographyCapture,
  TomographyFrequencySweep,
  TomographyGeometry,
} from '@/domain/tomography';

import { simulateTomographyCapture, type TomographySimulatedScatterer } from './simulator';

export type TomographyProviderStatus = {
  providerId: string;
  connected: boolean;
  hardwareProfileId: string;
  coherentClockAvailable: boolean;
  activePortCount: number;
  supportedStartFrequencyHz: number;
  supportedEndFrequencyHz: number;
  notes: string[];
};

export type TomographyAcquisitionConfiguration = {
  geometry: TomographyGeometry;
  sweep: TomographyFrequencySweep;
  temperatureCelsius?: number;
};

export interface TomographyScannerProvider {
  connect(): Promise<TomographyProviderStatus>;
  configure(configuration: TomographyAcquisitionConfiguration): Promise<void>;
  capture(input: {
    id: string;
    calibrationRole: TomographyCapture['calibrationRole'];
    referenceCaptureId?: string;
  }): Promise<TomographyCapture>;
  disconnect(): Promise<void>;
}

export class SimulatedTomographyProvider implements TomographyScannerProvider {
  private connected = false;
  private configuration?: TomographyAcquisitionConfiguration;
  private scatterers: TomographySimulatedScatterer[] = [];

  setScatterers(scatterers: TomographySimulatedScatterer[]) {
    this.scatterers = scatterers;
  }

  async connect(): Promise<TomographyProviderStatus> {
    this.connected = true;
    return {
      providerId: 'simulated-multistatic-array-v1',
      connected: true,
      hardwareProfileId: 'multistatic-wifi-band-tomography-array',
      coherentClockAvailable: true,
      activePortCount: this.configuration?.geometry.antennas.filter(({ enabled }) => enabled).length ?? 0,
      supportedStartFrequencyHz: 1_000_000_000,
      supportedEndFrequencyHz: 10_000_000_000,
      notes: ['Deterministisk simulator. Ingen fysisk eller anatomisk mätning.'],
    };
  }

  async configure(configuration: TomographyAcquisitionConfiguration): Promise<void> {
    if (!this.connected) throw new Error('Tomography provider is not connected.');
    if (!configuration.sweep.coherent) {
      throw new Error('Tomography v1 requires a coherent frequency sweep.');
    }
    this.configuration = configuration;
  }

  async capture(input: {
    id: string;
    calibrationRole: TomographyCapture['calibrationRole'];
    referenceCaptureId?: string;
  }): Promise<TomographyCapture> {
    if (!this.connected || !this.configuration) {
      throw new Error('Tomography provider is not configured.');
    }
    const capture = simulateTomographyCapture({
      id: input.id,
      geometry: this.configuration.geometry,
      calibrationRole: input.calibrationRole,
      frequenciesHz: this.configuration.sweep.frequenciesHz,
      temperatureCelsius: this.configuration.temperatureCelsius,
      scatterers:
        input.calibrationRole === 'background' ? [] : this.scatterers,
    });
    capture.referenceCaptureId = input.referenceCaptureId;
    return capture;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.configuration = undefined;
  }
}
