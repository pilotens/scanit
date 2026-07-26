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

type FrameMutator = (frames: WifiCsiFrame[]) => WifiCsiFrame[];

class FakeGatewayClient implements WifiGatewayClientLike {
  private frames: WifiCsiFrame[] = [];
  private sessionId = 'unstarted';
  lastConfiguration?: WifiGatewayConfiguration;

  constructor(
    private readonly receiverNodeIds = configuration.receiverNodeIds,
    private readonly mutateFrames: FrameMutator = (frames) => frames,
  ) {}

  async connect(): Promise<WifiGatewayStatus> {
    return this.gatewayStatus();
  }

  async status(): Promise<WifiGatewayStatus> {
    return this.gatewayStatus();
  }

  async configure(configurationInput: WifiGatewayConfiguration): Promise<WifiGatewayStatus> {
    this.lastConfiguration = configurationInput;
    return this.gatewayStatus();
  }

  async startStream(sessionId: string): Promise<WifiGatewayStatus> {
    this.sessionId = sessionId;
    const generated = simulateWifiCsiCapture({
      id: sessionId,
      soundingCount: configuration.soundingCount,
      calibrationSoundingCount: configuration.calibrationSoundingCount,
      soundingRateHz: configuration.soundingRateHz,
      receiverNodeIds: this.receiverNodeIds,
    }).frames.map((frame) => ({ ...frame, sessionId }));
    this.frames = this.mutateFrames(generated);
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
      supportsExplicitSoundingId: true,
      supportsSharedClock: false,
      softwareAlignedClock: true,
      receiverNodeIds: [...this.receiverNodeIds],
      receiverCount: this.receiverNodeIds.length,
      streaming: false,
      streamSessionId: null,
      explicitSoundingBatches: 0,
      fallbackSoundingBatches: 0,
      childSources: this.receiverNodeIds.map((receiverNodeId) => ({
        source: receiverNodeId,
        firmwareVersion: 'test-firmware-v2',
        deviceConnected: true,
        supportsExplicitSoundingId: true,
        csi0V2RecordsDecoded: 100,
        receiverDroppedRecordCount: 0,
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
  it('assembles transmitter-identified multi-link soundings into one immutable capture', async () => {
    const client = new FakeGatewayClient();
    const factory: WifiGatewayClientFactory = () => client;
    const provider = new GatewayWifiSensingProvider('ws://127.0.0.1:8770', factory);

    const status = await provider.connect();
    expect(status.nodeCount).toBe(4);
    await provider.configure(configuration);
    expect(client.lastConfiguration?.requireExplicitSoundingId).toBe(true);
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
    expect(new Set(capture.frames.map(({ soundingSessionNonce }) => soundingSessionNonce))).toEqual(
      new Set([0x5343414e]),
    );
    expect(capture.frames.every(({ soundingIdSource }) => soundingIdSource === 'transmitter-payload')).toBe(
      true,
    );
    expect(capture.tags).toContain('physical-gateway');
    expect(capture.tags).toContain('explicit-sounding-id');
    expect(capture.notes.join(' ')).toContain('SND1 nonce');
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

  it('rejects physical frames without transmitter sounding identity', async () => {
    const client = new FakeGatewayClient(configuration.receiverNodeIds, (frames) =>
      frames.map((frame) => ({
        ...frame,
        soundingIdSource: 'receiver-sequence-fallback',
        soundingSessionNonce: undefined,
      })),
    );
    const provider = new GatewayWifiSensingProvider('ws://127.0.0.1:8770', () => client);

    await provider.connect();
    await provider.configure(configuration);
    await expect(provider.capture({ id: 'missing-snd1' })).rejects.toThrow(/validated transmitter sounding ID/i);
    await provider.disconnect();
  });

  it('rejects receiver queue drops', async () => {
    const client = new FakeGatewayClient(configuration.receiverNodeIds, (frames) =>
      frames.map((frame, index) =>
        index === 0
          ? {
              ...frame,
              receiverDroppedRecordCount: 1,
              qualityFlags: [...frame.qualityFlags, 'receiver-queue-drops'],
            }
          : frame,
      ),
    );
    const provider = new GatewayWifiSensingProvider('ws://127.0.0.1:8770', () => client);

    await provider.connect();
    await provider.configure(configuration);
    await expect(provider.capture({ id: 'drop-test' })).rejects.toThrow(/dropped CSI0 records/i);
    await provider.disconnect();
  });
});
