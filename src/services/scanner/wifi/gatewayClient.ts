import type { WifiCsiFrame, WifiSensingBand, WifiSensingPhy } from '@/domain/wifiSensing';

import { decodeWifiCsiFrame } from './protocol/wcs1Codec';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type FrameWaiter = {
  resolve: (frame: WifiCsiFrame) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type GatewayResponse = {
  type: 'response';
  requestId?: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
};

type GatewayEvent = {
  type: 'event';
  event: string;
  payload?: unknown;
};

export type WifiGatewayConfiguration = {
  sessionId?: string;
  txNodeId?: string;
  band?: WifiSensingBand;
  channel?: number;
  centerFrequencyHz?: number;
  bandwidthHz?: number;
  phy?: WifiSensingPhy;
  spatialStream?: number;
  txAntenna?: number;
  frameRateHz?: number;
  requireExplicitSoundingId?: boolean;
  subcarrierIndices?: number[];
};

export type WifiGatewayChildStatus = {
  source?: string;
  firmwareVersion?: string;
  deviceConnected?: boolean;
  supportsExplicitSoundingId?: boolean;
  csi0RecordsDecoded?: number;
  csi0V1RecordsDecoded?: number;
  csi0V2RecordsDecoded?: number;
  receiverDroppedRecordCount?: number;
};

export type WifiGatewayStatus = {
  source: string;
  deviceConnected: boolean;
  supportsRawCsi: boolean;
  supportsExplicitSoundingId?: boolean;
  supportsSharedClock?: boolean;
  softwareAlignedClock?: boolean;
  clockDomain?: string;
  receiverNodeIds: string[];
  receiverCount: number;
  streaming: boolean;
  streamSessionId?: string | null;
  explicitSoundingBatches?: number;
  fallbackSoundingBatches?: number;
  duplicateReceiverFrames?: number;
  discardedUnpairedFrames?: number;
  transmitterSoundingGaps?: number;
  activeSoundingSessionNonce?: number | null;
  childSources?: WifiGatewayChildStatus[];
  config?: WifiGatewayConfiguration & { rxNodeId?: string };
  gateway?: {
    host: string;
    port: number;
    protocol: string;
    controlVersion?: number;
  };
};

export interface WifiGatewayClientLike {
  connect(timeoutMs?: number): Promise<WifiGatewayStatus>;
  status(): Promise<WifiGatewayStatus>;
  configure(configuration: WifiGatewayConfiguration): Promise<WifiGatewayStatus>;
  startStream(sessionId: string): Promise<WifiGatewayStatus>;
  stopStream(): Promise<WifiGatewayStatus>;
  nextFrame(timeoutMs?: number): Promise<WifiCsiFrame>;
  disconnect(): void;
}

const gatewayError = (message: string) => new Error(`Wi-Fi CSI gateway: ${message}`);

export class WifiCsiGatewayClient implements WifiGatewayClientLike {
  private socket?: WebSocket;
  private requestSequence = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly frames: WifiCsiFrame[] = [];
  private readonly frameWaiters: FrameWaiter[] = [];
  private lastEvent?: GatewayEvent;

  constructor(readonly url: string) {
    if (!/^wss?:\/\//i.test(url)) {
      throw new Error('Wi-Fi CSI gateway URL must begin with ws:// or wss://.');
    }
  }

  async connect(timeoutMs = 6_000): Promise<WifiGatewayStatus> {
    if (this.socket?.readyState === WebSocket.OPEN) return this.status();
    this.disconnect();

    const socket = new WebSocket(this.url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(gatewayError('connection timed out'));
      }, timeoutMs);
      socket.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(gatewayError('connection failed'));
      };
      socket.onclose = () => {
        if (this.socket === socket) {
          this.socket = undefined;
          this.rejectAll(gatewayError('connection closed'));
        }
      };
      socket.onmessage = (event: { data: unknown }) => {
        void this.handleMessage(event.data);
      };
    });

    return this.status();
  }

  disconnect() {
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    this.rejectAll(gatewayError('client disconnected'));
    this.frames.length = 0;
  }

  status(): Promise<WifiGatewayStatus> {
    return this.request<WifiGatewayStatus>('status');
  }

  configure(configuration: WifiGatewayConfiguration): Promise<WifiGatewayStatus> {
    return this.request<WifiGatewayStatus>('configure', configuration);
  }

  startStream(sessionId: string): Promise<WifiGatewayStatus> {
    this.frames.length = 0;
    return this.request<WifiGatewayStatus>('start', { sessionId });
  }

  stopStream(): Promise<WifiGatewayStatus> {
    return this.request<WifiGatewayStatus>('stop');
  }

  nextFrame(timeoutMs = 3_000): Promise<WifiCsiFrame> {
    const queued = this.frames.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const waiter: FrameWaiter = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          const index = this.frameWaiters.indexOf(waiter);
          if (index >= 0) this.frameWaiters.splice(index, 1);
          reject(gatewayError('frame timed out'));
        }, timeoutMs),
      };
      this.frameWaiters.push(waiter);
    });
  }

  getLastEvent() {
    return this.lastEvent;
  }

  private request<T>(
    type: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 5_000,
  ): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(gatewayError('not connected'));
    }
    const id = `wifi-req-${Date.now()}-${this.requestSequence++}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(gatewayError(`${type} request timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      socket.send(JSON.stringify({ id, type, payload }));
    });
  }

  private async handleMessage(data: unknown) {
    try {
      if (typeof data === 'string') {
        this.handleText(data);
        return;
      }
      const bytes = await this.toBytes(data);
      this.enqueueFrame(decodeWifiCsiFrame(bytes));
    } catch (error) {
      this.rejectFrameWaiters(
        error instanceof Error ? error : gatewayError('invalid gateway message'),
      );
    }
  }

  private handleText(raw: string) {
    const message = JSON.parse(raw) as GatewayResponse | GatewayEvent;
    if (message.type === 'event') {
      this.lastEvent = message;
      if (message.event === 'stream-error') {
        const payload = message.payload as { message?: string } | undefined;
        this.rejectFrameWaiters(gatewayError(payload?.message ?? 'stream failed'));
      }
      return;
    }
    const requestId = message.requestId;
    if (!requestId) return;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    if (message.ok) pending.resolve(message.payload);
    else pending.reject(gatewayError(message.error ?? 'request failed'));
  }

  private async toBytes(data: unknown): Promise<Uint8Array> {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    const blobLike = data as { arrayBuffer?: () => Promise<ArrayBuffer> };
    if (typeof blobLike?.arrayBuffer === 'function') {
      return new Uint8Array(await blobLike.arrayBuffer());
    }
    throw gatewayError('unsupported WebSocket binary payload');
  }

  private enqueueFrame(frame: WifiCsiFrame) {
    const waiter = this.frameWaiters.shift();
    if (waiter) {
      clearTimeout(waiter.timeout);
      waiter.resolve(frame);
      return;
    }
    this.frames.push(frame);
    if (this.frames.length > 2_048) this.frames.shift();
  }

  private rejectFrameWaiters(error: Error) {
    for (const waiter of this.frameWaiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  }

  private rejectAll(error: Error) {
    for (const [id, request] of this.pending) {
      clearTimeout(request.timeout);
      request.reject(error);
      this.pending.delete(id);
    }
    this.rejectFrameWaiters(error);
  }
}
