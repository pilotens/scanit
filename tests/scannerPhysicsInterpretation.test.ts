import { describe, expect, it } from 'vitest';

import { generateSyntheticRadioFrame } from '@/services/scanner/emulator/syntheticScanner';
import { computeBasicProfile } from '@/services/scanner/processing/profile';
import { trackScannerTarget } from '@/services/scanner/processing/targetTracking';
import { ScannerSignalPipeline } from '@/services/scanner/processing/pipeline';
import { evaluateScannerSignalQuality } from '@/services/scanner/quality/signalQualityEngine';
import { separateScannerPhysiology } from '@/services/scanner/processing/physiology';
import { interpretScannerEvidence } from '@/services/scanner/interpretation/evidenceEngine';

const buildFrames = (count = 220) => {
  const frameRateHz = 20;
  const calibrationCount = 20;
  const start = 1_900_000_000_000_000_000n;
  const interval = 50_000_000n;
  const frames = Array.from({ length: count }, (_, sequence) => {
    const frame = generateSyntheticRadioFrame({
      sessionId: 'physics-test',
      sequence,
      position: 'apex',
      elapsedSeconds: sequence / frameRateHz,
      motionScale: sequence < calibrationCount ? 0 : 1,
    });
    frame.timestampNs = String(start + BigInt(sequence) * interval);
    return frame;
  });
  return { frames, calibrationCount };
};

describe('scanner physics and interpretation boundaries', () => {
  it('preserves and processes RX × chirp × ADC cubes', () => {
    const frame = buildFrames(1).frames[0]!;
    expect(frame.dataLayout).toBe('rx-chirp-sample');
    expect(frame.sampleFormat).toBe('real-adc-in-iq-container');
    expect(frame.acquisition?.rawCubeShape).toEqual([3, 8, 64]);
    expect(frame.samplesPerChannel).toBe(8 * 64);

    const profile = computeBasicProfile(frame);
    expect(profile.chirpSpectra).toHaveLength(3);
    expect(profile.chirpSpectra?.[0]).toHaveLength(8);
    expect(profile.profile).toHaveLength(32);
    expect(profile.targetRangeMeters).toBeGreaterThan(0.2);
    expect(profile.targetRangeMeters).toBeLessThan(0.5);
    expect(profile.chirpCoherence).toBeGreaterThan(0.5);
  });

  it('tracks one physical range target and keeps medical interpretation disabled', () => {
    const { frames, calibrationCount } = buildFrames();
    const active = frames.slice(calibrationCount);
    const track = trackScannerTarget(active);
    expect(track.medianRangeMeters).toBeGreaterThan(0.2);
    expect(track.medianRangeMeters).toBeLessThan(0.5);
    expect(track.binStandardDeviation).toBeLessThan(2);

    const pipeline = new ScannerSignalPipeline();
    pipeline.calibrate(frames.slice(0, calibrationCount), 'infineon-bgt60tr13c-emulator');
    const analyses = active.map((frame, index) => pipeline.process(frame, track.bins[index]));
    const qualityGate = evaluateScannerSignalQuality(active, analyses);
    const physiology = separateScannerPhysiology(active, qualityGate);
    const interpretation = interpretScannerEvidence({
      frames: active,
      analyses,
      qualityGate,
      physiology,
      targetTrack: track,
    });

    expect(qualityGate.version).toBe('scanner-quality-v2');
    expect(qualityGate.metrics.find(({ id }) => id === 'raw-cube-preservation')?.passed).toBe(true);
    expect(interpretation.physicalTargetState).not.toBe('unsupported');
    expect(interpretation.tissueInterpretationState).toBe('not-supported');
    expect(interpretation.medicalInterpretationState).toBe('not-validated');
    expect(
      interpretation.claims.find(({ id }) => id === 'medical-condition')?.level,
    ).toBe('unsupported');
  });
});
