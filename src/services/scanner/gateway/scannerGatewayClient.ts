import type { RawRadioFrame } from '@/domain/radio';
import type { RfPosition } from '@/domain/scanning';
import { decodeRadioFrame } from '@/services/scanner/protocol/frameCodec';

import type {
  GatewayEvent,
  GatewayFmcwConfiguration,
  GatewayResponse,
  ScannerGatewayStatus,
} from './types';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type FrameWaiter = {
  resolve: (frame: RawRadioFrame) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const toError = (message: string) => new Error(`Scanner gateway: ${message}`);

export class ScannerGatewayClient {
  private socket?: WebSocket;
  private requestSequence = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly frames: RawRadioFrame[] = [];
  private readonly frameWaiters: FrameWaiter[] = [];
  private lastEvent?: GatewayEvent;

  constructor(readonly url: string) {
    if (!/^wss?:\/\//i.test(url)) {
      throw new Error('Scanner gateway URL must begin with ws:// or wss://.');
    }
  }

  async connect(timeoutMs = 6_000): Promise<ScannerGatewayStatus> {
    if (this.socket?.readyState === WebSocket.OPEN) return this.status();
    this.disconnect();

    const socket = new WebSocket(this.url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(toError('connection timed out'));
      }, timeoutMs);
      socket.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(toError('connection failed'));
      };
      socket.onclose = () => {
        if (this.socket === socket) {
          this.socket = undefined;
          this.rejectAll(toError('connection closed'));
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
    this.rejectAll(toError('client disconnected'));
    this.frames.length = 0;
  }

  status(): Promise<ScannerGatewayStatus> {
    return this.request<ScannerGatewayStatus>('status');
  }

  configure(configuration: GatewayFmcwConfiguration): Promise<ScannerGatewayStatus> {
    return this.request<ScannerGatewayStatus>('configure', configuration);
  }

  calibrate(): Promise<ScannerGatewayStatus> {
    return this.request<ScannerGatewayStatus>('calibrate');
  }

  startStream(sessionId: string, position: RfPosition): Promise<ScannerGatewayStatus> {
    this.frames.length = 0;
    return this.request<ScannerGatewayStatus>('start', { sessionId, position });
  }

  stopStream(): Promise<ScannerGatewayStatus> {
    return this.request<ScannerGatewayStatus>('stop');
  }

  nextFrame(timeoutMs = 3_000): Promise<RawRadioFrame> {
    const queued = this.frames.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const waiter: FrameWaiter = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          const index = this.frameWaiters.indexOf(waiter);
          if (index >= 0) this.frameWaiters.splice(index, 1);
          reject(toError('frame timed out'));
        }, timeoutMs),
      };
      this.frameWaiters.push(waiter);
    });
  }

  getLastEvent() {
    return this.lastEvent;
  }

  private request<T>(type: string, payload: Record<string, unknown> = {}, timeoutMs = 5_000): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(toError('not connected'));
    }
    const id = `req-${Date.now()}-${this.requestSequence++}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(toError(`${type} request timed out`));
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
      this.enqueueFrame(decodeRadioFrame(bytes));
    } catch (error) {
      this.rejectFrameWaiters(error instanceof Error ? error : toError('invalid gateway message'));
    }
  }

  private handleText(raw: string) {
    const message = JSON.parse(raw) as GatewayResponse | GatewayEvent;
    if (message.type === 'event') {
      this.lastEvent = message;
      if (message.event === 'stream-error') {
        const payload = message.payload as { message?: string } | undefined;
        this.rejectFrameWaiters(toError(payload?.message ?? 'stream failed'));
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
    else pending.reject(toError(message.error ?? 'request failed'));
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
    throw toError('unsupported WebSocket binary payload');
  }

  private enqueueFrame(frame: RawRadioFrame) {
    const waiter = this.frameWaiters.shift();
    if (waiter) {
      clearTimeout(waiter.timeout);
      waiter.resolve(frame);
      return;
    }
    this.frames.push(frame);
    if (this.frames.length > 64) this.frames.shift();
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
