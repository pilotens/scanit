import { describe, expect, it } from 'vitest';

import type { WifiCsiFrame } from '@/domain/wifiSensing';
import {
  GatewayWifiSensingProvider,
  type WifiGatewayClientFactory,
} from '@/services/scanner/wifi/gatewayProvider';
import type {
  WifiGatewayClientLike,
  WifiGatewayConfiguration,
  WifiGatewayStatus,
} from '@/services/scanner/wifi/gatewayClient';
import type { WifiSensingConfiguration } from '@/services/scanner/wifi/provider';
import { simulateWifiCsiCapture } from '@/services/scanner/wifi/simulator';

const configuration: WifiSensingConfiguration = {
  band: '5-ghz',
  channel: 36,
  bandwidthHz: 20_000_000,
  soundingRateHz: 20,
  soundingCount: 60,
  calibrationSoundingCount: 12,
  receiverNodeIds: ['rx-left', 'rx-right', 'rx-reference'],
};

class FakeGatewayClient implements WifiGatewayClientLike {
  private frames: WifiCsiFrame[] = [];
  private sessionId = 'unstarted';

  constructor(private readonly receiverNodeIds = configuration.receiverNodeIds) {}

  async connect(): Promise<WifiGatewayStatus> {
    return this.gatewayStatus();
  }

  async status(): Promise<WifiGatewayStatus> {
    return this.gatewayStatus();
  }

  async configure(_configuration: WifiGatewayConfiguration): Promise<WifiGatewayStatus> {
    return this.gatewayStatus();
  }

  async startStream(sessionId: string): Promise<WifiGatewayStatus> {
    this.sessionId = sessionId;
    this.frames = simulateWifiCsiCapture({
      id: sessionId,
      soundingCount: configuration.soundingCount,
      calibrationSoundingCount: configuration.calibrationSoundingCount,
      soundingRateHz: configuration.soundingRateHz,
      receiverNodeIds: this.receiverNodeIds,
    }).frames.map((frame) => ({ ...frame, sessionId }));
    return { ...this.gatewayStatus(), streaming: true, streamSessionId: sessionId };
  }

  async stopStream(): Promise<WifiGatewayStatus> {
    return this.gatewayStatus();
  }

  async nextFrame(): Promise<WifiCsiFrame> {
    const frame = this.frames.shift();
    if (!frame) throw new Error('No more fake WCS1 frames.');
    return frame;
  }

  disconnect(): void {
    this.frames = [];
  }

  private gatewayStatus(): WifiGatewayStatus {
    return {
      source: 'test-wifi-gateway',
      deviceConnected: true,
      supportsRawCsi: true,
      supportsSharedClock: true,
      receiverNodeIds: [...this.receiverNodeIds],
      receiverCount: this.receiverNodeIds.length,
      streaming: false,
      streamSessionId: null,
      childSources: this.receiverNodeIds.map((receiverNodeId) => ({
        source: receiverNodeId,
        firmwareVersion: 'test-firmware-v1',
        deviceConnected: true,
      })),
      gateway: {
        host: '127.0.0.1',
        port: 8770,
        protocol: 'WCS1/WebSocket',
        controlVersion: 1,
      },
    };
  }
}

describe('physical Wi-Fi CSI gateway provider', () => {
  it('assembles complete multi-link soundings into one immutable capture', async () => {
    const client = new FakeGatewayClient();
    const factory: WifiGatewayClientFactory = () => client;
    const provider = new GatewayWifiSensingProvider('ws://127.0.0.1:8770', factory);

    const status = await provider.connect();
    expect(status.nodeCount).toBe(4);
    await provider.configure(configuration);
    const capture = await provider.capture({ id: 'physical-provider-test' });
    await provider.disconnect();

    expect(capture.id).toBe('physical-provider-test');
    expect(capture.source).toBe('test-wifi-gateway');
    expect(capture.frames).toHaveLength(
      configuration.soundingCount * configuration.receiverNodeIds.length,
    );
    expect(new Set(capture.frames.map(({ soundingSequence }) => soundingSequence)).size).toBe(
      configuration.soundingCount,
    );
    expect(new Set(capture.frames.map(({ rxNodeId }) => rxNodeId)).size).toBe(3);
    expect(capture.tags).toContain('physical-gateway');
  });

  it('rejects gateways that expose only one receiver link', async () => {
    const client = new FakeGatewayClient(['rx-only']);
    const provider = new GatewayWifiSensingProvider(
      'ws://127.0.0.1:8770',
      () => client,
    );

    await provider.connect();
    await expect(provider.configure(configuration)).rejects.toThrow(/at least two receiver/i);
    await provider.disconnect();
  });
});
