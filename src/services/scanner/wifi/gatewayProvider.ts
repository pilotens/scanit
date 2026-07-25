import type { WifiCsiFrame, WifiSensingCapture } from '@/domain/wifiSensing';

import {
  WifiCsiGatewayClient,
  type WifiGatewayClientLike,
  type WifiGatewayStatus,
} from './gatewayClient';
import type {
  WifiSensingConfiguration,
  WifiSensingProvider,
  WifiSensingProviderStatus,
} from './provider';

export type WifiGatewayClientFactory = (url: string) => WifiGatewayClientLike;

const centerFrequencyHz = (band: WifiSensingConfiguration['band'], channel: number) => {
  if (band === '2.4-ghz') {
    if (channel === 14) return 2_484_000_000;
    return 2_407_000_000 + channel * 5_000_000;
  }
  if (band === '6-ghz') return 5_950_000_000 + channel * 5_000_000;
  return 5_000_000_000 + channel * 5_000_000;
};

const unique = <T,>(values: T[]) => [...new Set(values)];

export class GatewayWifiSensingProvider implements WifiSensingProvider {
  private client?: WifiGatewayClientLike;
  private gatewayStatus?: WifiGatewayStatus;
  private configuration?: WifiSensingConfiguration;

  constructor(
    readonly url: string,
    private readonly clientFactory: WifiGatewayClientFactory = (gatewayUrl) =>
      new WifiCsiGatewayClient(gatewayUrl),
  ) {
    if (!/^wss?:\/\//i.test(url)) {
      throw new Error('Wi-Fi CSI gateway URL must begin with ws:// or wss://.');
    }
  }

  async connect(): Promise<WifiSensingProviderStatus> {
    this.client?.disconnect();
    this.client = this.clientFactory(this.url);
    const status = await this.client.connect();
    this.validateGateway(status);
    this.gatewayStatus = status;
    return this.providerStatus(status);
  }

  async configure(
    configuration: WifiSensingConfiguration,
  ): Promise<WifiSensingProviderStatus> {
    if (!this.client) await this.connect();
    if (configuration.soundingRateHz <= 0 || configuration.soundingRateHz > 100) {
      throw new Error('Wi-Fi sounding rate must be between 1 and 100 Hz.');
    }
    if (configuration.soundingCount < configuration.calibrationSoundingCount + 20) {
      throw new Error('Wi-Fi capture must contain calibration and analysis soundings.');
    }

    const status = await this.client!.configure({
      band: configuration.band,
      channel: configuration.channel,
      centerFrequencyHz: centerFrequencyHz(configuration.band, configuration.channel),
      bandwidthHz: configuration.bandwidthHz,
      frameRateHz: configuration.soundingRateHz,
    });
    this.validateGateway(status);
    if (status.receiverCount < 2) {
      throw new Error('The physical Wi-Fi CSI gateway must expose at least two receiver links.');
    }
    this.configuration = {
      ...configuration,
      receiverNodeIds: [...status.receiverNodeIds],
    };
    this.gatewayStatus = status;
    return this.providerStatus(status);
  }

  async capture(input: {
    id?: string;
    tags?: string[];
    notes?: string[];
  }): Promise<WifiSensingCapture> {
    const client = this.client;
    const configuration = this.configuration;
    const gatewayStatus = this.gatewayStatus;
    if (!client || !configuration || !gatewayStatus) {
      throw new Error('Connect and configure the Wi-Fi CSI gateway before capture.');
    }

    const id = input.id ?? `wifi-physical-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const expectedReceivers = new Set(gatewayStatus.receiverNodeIds);
    const framesBySounding = new Map<number, Map<string, WifiCsiFrame>>();
    const targetSoundings = configuration.soundingCount;
    const minimumSoundings = configuration.calibrationSoundingCount + 20;
    const timeoutMs = Math.max(
      15_000,
      Math.ceil((targetSoundings / configuration.soundingRateHz) * 1_000) + 12_000,
    );
    const deadline = Date.now() + timeoutMs;

    await client.startStream(id);
    try {
      while (Date.now() < deadline) {
        const completed = [...framesBySounding.values()].filter((group) =>
          expectedReceivers.size
            ? [...expectedReceivers].every((receiverId) =>
                [...group.values()].some(({ rxNodeId }) => rxNodeId === receiverId),
              )
            : group.size >= 2,
        ).length;
        if (completed >= targetSoundings) break;

        const frame = await client.nextFrame(3_000);
        if (frame.sessionId !== id) continue;
        const group = framesBySounding.get(frame.soundingSequence) ?? new Map();
        const linkKey = `${frame.rxNodeId}:${frame.rxAntenna}:${frame.spatialStream}`;
        if (!group.has(linkKey)) group.set(linkKey, frame);
        framesBySounding.set(frame.soundingSequence, group);
      }
    } finally {
      await client.stopStream().catch(() => undefined);
    }

    const completeSoundings = [...framesBySounding.entries()]
      .filter(([, group]) =>
        expectedReceivers.size
          ? [...expectedReceivers].every((receiverId) =>
              [...group.values()].some(({ rxNodeId }) => rxNodeId === receiverId),
            )
          : group.size >= 2,
      )
      .sort(([left], [right]) => left - right)
      .slice(0, targetSoundings);

    if (completeSoundings.length < minimumSoundings) {
      throw new Error(
        `Only ${completeSoundings.length} complete Wi-Fi soundings were captured; ` +
          `${minimumSoundings} are required.`,
      );
    }

    const frames = completeSoundings
      .flatMap(([, group]) => [...group.values()])
      .sort(
        (left, right) =>
          left.soundingSequence - right.soundingSequence ||
          left.rxNodeId.localeCompare(right.rxNodeId) ||
          left.rxAntenna - right.rxAntenna,
      );

    return {
      schemaVersion: 1,
      id,
      createdAt,
      completedAt: new Date().toISOString(),
      source: gatewayStatus.source,
      hardwareProfileId: 'esp32-c5-csi-pair',
      frames,
      calibrationSoundingCount: Math.min(
        configuration.calibrationSoundingCount,
        Math.max(1, completeSoundings.length - 20),
      ),
      tags: unique(['wifi-csi', 'physical-gateway', ...(input.tags ?? [])]),
      notes: input.notes ?? [],
    };
  }

  async disconnect(): Promise<void> {
    this.client?.disconnect();
    this.client = undefined;
    this.gatewayStatus = undefined;
    this.configuration = undefined;
  }

  private validateGateway(status: WifiGatewayStatus) {
    if (!status.deviceConnected) {
      throw new Error('The Wi-Fi CSI gateway is reachable but its receiver sources are not connected.');
    }
    if (!status.supportsRawCsi) {
      throw new Error('The Wi-Fi gateway does not expose raw CSI.');
    }
    if (status.gateway?.protocol !== 'WCS1/WebSocket') {
      throw new Error('The endpoint does not report the WCS1/WebSocket protocol.');
    }
  }

  private providerStatus(status: WifiGatewayStatus): WifiSensingProviderStatus {
    const childSources = status.childSources ?? [];
    return {
      source: status.source,
      connected: status.deviceConnected,
      nodeCount: status.receiverCount + 1,
      firmwareVersions: unique(
        childSources.map(({ firmwareVersion, source }) => firmwareVersion ?? source ?? 'unknown'),
      ),
      supportsRawCsi: status.supportsRawCsi,
      supportsSharedClock: Boolean(status.supportsSharedClock),
    };
  }
}
