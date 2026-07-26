import type { RfPosition } from '@/domain/scanning';

export type GatewayFmcwConfiguration = {
  startFrequencyHz: number;
  endFrequencyHz: number;
  sampleRateHz: number;
  samplesPerChirp: number;
  chirpsPerFrame: number;
  frameRateHz: number;
  chirpRepetitionTimeSeconds: number;
  rxMask: number;
  txMask: number;
  txPowerLevel: number;
  lowPassCutoffHz: number;
  highPassCutoffHz: number;
  ifGainDb: number;
};

export type ScannerGatewayStatus = {
  source: string;
  deviceConnected: boolean;
  streaming: boolean;
  boardUuid?: string | null;
  sdkVersion?: string | null;
  streamSessionId?: string | null;
  streamPosition?: RfPosition | null;
  config?: Partial<GatewayFmcwConfiguration>;
  gateway?: {
    host: string;
    port: number;
    protocol: string;
  };
};

export type GatewayResponse = {
  type: 'response';
  requestId: string | null;
  ok: boolean;
  payload?: unknown;
  error?: string;
};

export type GatewayEvent = {
  type: 'event';
  event: string;
  payload?: unknown;
};

export const defaultGatewayFmcwConfiguration: GatewayFmcwConfiguration = {
  startFrequencyHz: 58_000_000_000,
  endFrequencyHz: 63_000_000_000,
  sampleRateHz: 2_000_000,
  samplesPerChirp: 128,
  chirpsPerFrame: 32,
  frameRateHz: 20,
  chirpRepetitionTimeSeconds: 0.0005,
  rxMask: 0b111,
  txMask: 0b001,
  txPowerLevel: 31,
  lowPassCutoffHz: 500_000,
  highPassCutoffHz: 80_000,
  ifGainDb: 33,
};
