import { useCallback, useMemo, useState } from 'react';

import type { ScanProgressEvent, ScanSession } from '@/domain/scanning';
import { ScanCoordinator } from '@/services/scanning/scanCoordinator';
import { ImportedWearableProvider } from '@/services/sensors/importedWearable';
import { MockRfScannerProvider } from '@/services/sensors/mockRfScanner';
import { MockWearableProvider } from '@/services/sensors/mockWearable';
import { useAppState } from '@/state/AppProvider';

const idleProgress: ScanProgressEvent = {
  phase: 'idle',
  progress: 0,
  title: 'Redo för utvidgad skanning',
  instruction: 'Sitt ned, vila armen och placera RF-modulen enligt instruktionerna.',
};

export function useScanSession() {
  const { baseline, latestVitals, addScanSession } = useAppState();
  const [progress, setProgress] = useState<ScanProgressEvent>(idleProgress);
  const [result, setResult] = useState<ScanSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  const coordinator = useMemo(
    () =>
      new ScanCoordinator({
        wearable:
          latestVitals.source === 'healthkit'
            ? new ImportedWearableProvider(latestVitals)
            : new MockWearableProvider(),
        rfScanner: new MockRfScannerProvider(),
        baseline,
      }),
    [baseline, latestVitals],
  );

  const start = useCallback(async () => {
    if (!['idle', 'completed', 'failed'].includes(progress.phase)) return;

    setError(null);
    setResult(null);

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
    }
  }, [addScanSession, coordinator, progress.phase]);

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
