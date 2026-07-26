import { GatewayRfScannerProvider } from '@/services/scanner/gateway/gatewayRfScanner';
import { MockRfScannerProvider } from '@/services/sensors/mockRfScanner';
import type { RfScannerProvider } from '@/services/sensors/types';

export type ScannerRuntimeState =
  | { mode: 'emulator' }
  | { mode: 'gateway'; url: string };

let state: ScannerRuntimeState = { mode: 'emulator' };

export const scannerRuntime = {
  getState: () => state,
  useEmulator: () => {
    state = { mode: 'emulator' };
  },
  useGateway: (url: string) => {
    state = { mode: 'gateway', url };
  },
  createProvider(): RfScannerProvider {
    return state.mode === 'gateway'
      ? new GatewayRfScannerProvider(state.url)
      : new MockRfScannerProvider();
  },
};
