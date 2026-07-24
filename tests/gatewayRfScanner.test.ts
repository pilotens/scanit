import { describe, expect, it } from 'vitest';

import type { ScannerFrameAnalysis } from '@/domain/radio';
import { summarizeAnalyses } from '@/services/scanner/gateway/gatewayRfScanner';

const analysis = (sequence: number, displacement: number): ScannerFrameAnalysis => ({
  sequence,
  modality: 'mmwave-fmcw',
  targetBin: 3,
  targetRangeMeters: 0.09,
  normalizedProfile: [0.1, 0.2, 0.4, 1, 0.2],
  baselineDeltaProfile: [0.01, 0.02, 0.03, 0.04, 0.02],
  phaseRadians: 0.2,
  phaseDeltaRadians: 0.01,
  displacementMillimeters: displacement,
  motionScore: 0.2,
  signalToNoiseRatioDb: 18,
  signalQuality: 'excellent',
  qualityFlags: [],
});

describe('physical scanner aggregation', () => {
  it('produces a non-simulated observation', () => {
    const result = summarizeAnalyses('apex', 12, [
      analysis(1, 0.08),
      analysis(2, 0.1),
      analysis(3, 0.09),
    ]);
    expect(result.isSimulated).toBe(false);
    expect(result.signalQuality).toBe('excellent');
    expect(result.mechanicalRegularity).toBeGreaterThan(0.9);
    expect(result.sampleCount).toBe(12);
  });
});
