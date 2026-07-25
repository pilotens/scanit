import type { TomographyCapture } from '@/domain/tomography';

import type {
  TomographyAcquisitionConfiguration,
  TomographyProviderStatus,
  TomographyScannerProvider,
} from './provider';
import { validateTomographyCapture } from './validation';

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type TomographyGatewayResponse = {
  requestId?: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
};

const gatewayError = (message: string) =>
  new Error(`Tomography gateway: ${message}`);

export class TomographyGatewayProvider implements TomographyScannerProvider {
  private socket?: WebSocket;
  private requestSequence = 0;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(readonly url: string) {
    if (!/^wss?:\/\//i.test(url)) {
      throw new Error('Tomography gateway URL must begin with ws:// or wss://.');
    }
  }

  async connect(timeoutMs = 8_000): Promise<TomographyProviderStatus> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return this.request<TomographyProviderStatus>('status');
    }
    await this.disconnect();
    const socket = new WebSocket(this.url);
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
        if (typeof event.data !== 'string') return;
        this.handleResponse(event.data);
      };
    });
    return this.request<TomographyProviderStatus>('status');
  }

  async configure(
    configuration: TomographyAcquisitionConfiguration,
  ): Promise<void> {
    await this.request('configure', { configuration }, 12_000);
  }

  async capture(input: {
    id: string;
    calibrationRole: TomographyCapture['calibrationRole'];
    referenceCaptureId?: string;
  }): Promise<TomographyCapture> {
    const capture = await this.request<TomographyCapture>(
      'capture',
      { capture: input },
      120_000,
    );
    const validation = validateTomographyCapture(capture);
    if (!validation.valid) {
      throw gatewayError(
        `capture failed schema validation: ${validation.errors.join(' ')}`,
      );
    }
    return capture;
  }

  async disconnect(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    this.rejectAll(gatewayError('client disconnected'));
  }

  private request<T>(
    type: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 8_000,
  ): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(gatewayError('not connected'));
    }
    const id = `tom-${Date.now()}-${this.requestSequence++}`;
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

  private handleResponse(raw: string) {
    try {
      const response = JSON.parse(raw) as TomographyGatewayResponse;
      if (!response.requestId) return;
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(response.requestId);
      if (response.ok) pending.resolve(response.payload);
      else pending.reject(gatewayError(response.error ?? 'request failed'));
    } catch (error) {
      this.rejectAll(
        error instanceof Error ? error : gatewayError('invalid response'),
      );
    }
  }

  private rejectAll(error: Error) {
    for (const [id, request] of this.pending) {
      clearTimeout(request.timeout);
      request.reject(error);
      this.pending.delete(id);
    }
  }
}
