import { useCallback, useState } from 'react';

import type { ScanProgressEvent, ScanSession } from '@/domain/scanning';
import { ScanCoordinator } from '@/services/scanning/scanCoordinator';
import { scannerRuntime } from '@/services/scanner/runtime/scannerRuntime';
import { MockWearableProvider } from '@/services/sensors/mockWearable';
import { useAppState } from '@/state/AppProvider';

const idleProgress: ScanProgressEvent = {
  phase: 'idle',
  progress: 0,
  title: 'Redo för utvidgad skanning',
  instruction: 'Sitt ned, vila armen och placera RF-modulen enligt instruktionerna.',
};

export function useScanSession() {
  const { baseline, addScanSession } = useAppState();
  const [progress, setProgress] = useState<ScanProgressEvent>(idleProgress);
  const [result, setResult] = useState<ScanSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (!['idle', 'completed', 'failed'].includes(progress.phase)) return;

    setError(null);
    setResult(null);
    const rfScanner = scannerRuntime.createProvider();
    const coordinator = new ScanCoordinator({
      wearable: new MockWearableProvider(),
      rfScanner,
      baseline,
    });

    try {
      const session = await coordinator.run({ onProgress: setProgress });
      setResult(session);
      addScanSession(session);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : 'Skanningen kunde inte slutföras.';
      setError(message);
      setProgress({
        phase: 'failed',
        progress: 0,
        title: 'Skanningen avbröts',
        instruction: 'Kontrollera sensorerna och försök igen.',
      });
    } finally {
      await rfScanner.disconnect?.();
    }
  }, [addScanSession, baseline, progress.phase]);

  const reset = useCallback(() => {
    setProgress(idleProgress);
    setResult(null);
    setError(null);
  }, []);

  return {
    progress,
    result,
    error,
    isRunning: !['idle', 'completed', 'failed'].includes(progress.phase),
    start,
    reset,
  };
}
