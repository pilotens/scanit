import type { WifiSensingCapture } from '@/domain/wifiSensing';

import { simulateWifiCsiCapture, type SimulatedWifiCsiOptions } from './simulator';

export type WifiSensingConfiguration = {
  band: '2.4-ghz' | '5-ghz' | '6-ghz';
  channel: number;
  bandwidthHz: number;
  soundingRateHz: number;
  soundingCount: number;
  calibrationSoundingCount: number;
  receiverNodeIds: string[];
};

export type WifiSensingProviderStatus = {
  source: string;
  connected: boolean;
  nodeCount: number;
  firmwareVersions: string[];
  supportsRawCsi: boolean;
  supportsSharedClock: boolean;
};

export interface WifiSensingProvider {
  connect(): Promise<WifiSensingProviderStatus>;
  configure(configuration: WifiSensingConfiguration): Promise<WifiSensingProviderStatus>;
  capture(input: { id?: string; tags?: string[]; notes?: string[] }): Promise<WifiSensingCapture>;
  disconnect(): Promise<void>;
}

export const defaultWifiSensingConfiguration: WifiSensingConfiguration = {
  band: '5-ghz',
  channel: 36,
  bandwidthHz: 20_000_000,
  soundingRateHz: 20,
  soundingCount: 240,
  calibrationSoundingCount: 24,
  receiverNodeIds: ['rx-left', 'rx-right', 'rx-reference'],
};

export class SimulatedWifiSensingProvider implements WifiSensingProvider {
  private connected = false;
  private configuration = defaultWifiSensingConfiguration;
  private simulatorOptions: Pick<
    SimulatedWifiCsiOptions,
    'motionScale' | 'multipathDriftScale'
  > = {};

  setSimulation(options: Pick<SimulatedWifiCsiOptions, 'motionScale' | 'multipathDriftScale'>) {
    this.simulatorOptions = { ...options };
  }

  async connect(): Promise<WifiSensingProviderStatus> {
    this.connected = true;
    return this.status();
  }

  async configure(configuration: WifiSensingConfiguration): Promise<WifiSensingProviderStatus> {
    if (!this.connected) await this.connect();
    if (configuration.soundingRateHz <= 0 || configuration.soundingRateHz > 100) {
      throw new Error('Wi-Fi sounding rate must be between 1 and 100 Hz.');
    }
    if (configuration.soundingCount < configuration.calibrationSoundingCount + 20) {
      throw new Error('Wi-Fi capture must contain calibration and analysis soundings.');
    }
    if (configuration.receiverNodeIds.length < 2) {
      throw new Error('At least two receiver links are required for CSI-ratio sensing.');
    }
    this.configuration = {
      ...configuration,
      receiverNodeIds: [...configuration.receiverNodeIds],
    };
    return this.status();
  }

  async capture(input: { id?: string; tags?: string[]; notes?: string[] }): Promise<WifiSensingCapture> {
    if (!this.connected) throw new Error('Wi-Fi sensing provider is not connected.');
    const capture = simulateWifiCsiCapture({
      id: input.id,
      soundingCount: this.configuration.soundingCount,
      calibrationSoundingCount: this.configuration.calibrationSoundingCount,
      soundingRateHz: this.configuration.soundingRateHz,
      receiverNodeIds: this.configuration.receiverNodeIds,
      ...this.simulatorOptions,
    });
    capture.tags = [...new Set([...(input.tags ?? []), ...capture.tags])];
    capture.notes = input.notes ?? [];
    return capture;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  private status(): WifiSensingProviderStatus {
    return {
      source: 'deterministic-wifi-csi-simulator',
      connected: this.connected,
      nodeCount: this.configuration.receiverNodeIds.length + 1,
      firmwareVersions: ['wifi-csi-simulator-v1'],
      supportsRawCsi: true,
      supportsSharedClock: true,
    };
  }
}