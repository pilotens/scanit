import { beforeEach, describe, expect, it } from 'vitest';

import { generateSyntheticRadioFrame } from '@/services/scanner/emulator/syntheticScanner';
import {
  compareReplayToPersonalBaseline,
  scannerBaselineRepository,
} from '@/services/scanner/baseline/baselineRepository';
import { scannerRecordingRepository } from '@/services/scanner/recording/recordingRepository';
import { replayScannerRecording } from '@/services/scanner/replay/replayEngine';

const buildFrames = () => {
  const frameRateHz = 20;
  const frameCount = 220;
  const calibrationFrames = 20;
  const startTimestampNs = 1_800_000_000_000_000_000n;
  const intervalNs = BigInt(Math.round(1_000_000_000 / frameRateHz));
  return {
    calibrationFrames,
    frames: Array.from({ length: frameCount }, (_, sequence) => {
      const frame = generateSyntheticRadioFrame({
        sessionId: 'quality-baseline-test',
        sequence,
        position: 'apex',
        elapsedSeconds: sequence / frameRateHz,
        motionScale: sequence < calibrationFrames ? 0 : 1,
      });
      frame.timestampNs = String(startTimestampNs + BigInt(sequence) * intervalNs);
      return frame;
    }),
  };
};

describe('scanner quality, physiology and personal baseline', () => {
  beforeEach(async () => {
    await scannerRecordingRepository.clear();
    await scannerBaselineRepository.clear();
  });

  it('approves a stable raw-cube capture and separates periodic bands', async () => {
    const input = buildFrames();
    const manifest = await scannerRecordingRepository.save({
      frames: input.frames,
      source: 'emulator',
      sourceDescriptor: 'quality-test',
      hardwareProfileId: 'infineon-bgt60tr13c-emulator',
      calibrationFrameCount: input.calibrationFrames,
    });
    const replay = replayScannerRecording(await scannerRecordingRepository.load(manifest.id));

    expect(replay.processingVersion).toBe('scanner-pipeline-v3');
    expect(replay.qualityGate.version).toBe('scanner-quality-v2');
    expect(replay.qualityGate.verdict).toBe('approved');
    expect(replay.qualityGate.score).toBeGreaterThanOrEqual(75);
    expect(replay.qualityGate.estimatedFrameRateHz).toBeCloseTo(20, 1);
    expect(replay.targetTracking.confidence).toBeGreaterThan(0.25);
    expect(replay.summary.averageChirpCoherence).toBeGreaterThan(0.5);
    expect(replay.physiology.version).toBe('scanner-physiology-v2');
    expect(replay.physiology.cardiacTrace.length).toBeGreaterThan(10);
    expect(replay.physiology.respirationTrace.length).toBeGreaterThan(10);
    expect(replay.physiology.cardiacMechanicalRateBpm).toBeGreaterThan(40);
    expect(replay.physiology.cardiacMechanicalRateBpm).toBeLessThan(180);
    expect(replay.physiology.respiratoryRateBpm).toBeGreaterThan(5);
    expect(replay.physiology.respiratoryRateBpm).toBeLessThan(35);
    expect(replay.interpretation.medicalInterpretationState).toBe('not-validated');
    expect(replay.interpretation.tissueInterpretationState).toBe('not-supported');
  });

  it('only builds a baseline from approved captures and recognizes the source replay', async () => {
    const input = buildFrames();
    const manifest = await scannerRecordingRepository.save({
      frames: input.frames,
      source: 'emulator',
      sourceDescriptor: 'baseline-test',
      hardwareProfileId: 'infineon-bgt60tr13c-emulator',
      calibrationFrameCount: input.calibrationFrames,
    });
    const replay = replayScannerRecording(await scannerRecordingRepository.load(manifest.id));
    const baseline = await scannerBaselineRepository.addReplay(replay);
    const comparison = compareReplayToPersonalBaseline(baseline, replay);

    expect(baseline.sourceCount).toBe(1);
    expect(baseline.sourceRecordingIds).toContain(replay.recordingId);
    expect(comparison.compatible).toBe(true);
    expect(comparison.profileCosineSimilarity).toBeCloseTo(1, 5);
    expect(comparison.classification).toBe('within-baseline');
  });
});
