import { beforeEach, describe, expect, it } from 'vitest';

import { generateSyntheticRadioFrame } from '@/services/scanner/emulator/syntheticScanner';
import { base64ToBytes, bytesToBase64 } from '@/services/scanner/recording/base64';
import { scannerRecordingRepository } from '@/services/scanner/recording/recordingRepository';
import { compareScannerReplays, replayScannerRecording } from '@/services/scanner/replay/replayEngine';

const frames = (position: 'apex' | 'left-sternal', motionScale: number) =>
  Array.from({ length: 32 }, (_, sequence) =>
    generateSyntheticRadioFrame({
      sessionId: `test-${position}-${motionScale}`,
      sequence,
      position,
      elapsedSeconds: sequence / 20,
      motionScale: sequence < 8 ? 0 : motionScale,
    }),
  );

describe('scanner record and replay', () => {
  beforeEach(async () => {
    await scannerRecordingRepository.clear();
  });

  it('round-trips arbitrary binary bytes through the portable base64 codec', () => {
    const source = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    expect([...base64ToBytes(bytesToBase64(source))]).toEqual([...source]);
  });

  it('stores chunked SCN1 raw cubes and replays them through the signal pipeline', async () => {
    const manifest = await scannerRecordingRepository.save({
      frames: frames('apex', 1),
      source: 'emulator',
      sourceDescriptor: 'test-emulator',
      hardwareProfileId: 'infineon-bgt60tr13c-emulator',
      calibrationFrameCount: 8,
      label: 'Apex test',
    });
    expect(manifest.dataChunkCount).toBe(8);
    expect(manifest.frameCount).toBe(32);
    expect(manifest.aggregateCrc32).toMatch(/^[0-9a-f]{8}$/);
    expect(manifest.qualityFlags).not.toContain('raw-cube-not-preserved');

    const recording = await scannerRecordingRepository.load(manifest.id);
    expect(recording.frames).toHaveLength(32);
    expect(recording.frames[0]?.acquisition?.rawCubeShape).toEqual([3, 8, 64]);
    const replay = replayScannerRecording(recording);
    expect(replay.summary.processedFrameCount).toBe(24);
    expect(replay.summary.averageSignalToNoiseRatioDb).toBeGreaterThan(6);
    expect(replay.profile.length).toBeGreaterThan(8);
    expect(replay.targetTracking.confidence).toBeGreaterThan(0);
  });

  it('compares two immutable recordings without needing scanner hardware', async () => {
    const first = await scannerRecordingRepository.save({
      frames: frames('apex', 1),
      source: 'emulator',
      sourceDescriptor: 'test-emulator',
      hardwareProfileId: 'infineon-bgt60tr13c-emulator',
      calibrationFrameCount: 8,
    });
    const second = await scannerRecordingRepository.save({
      frames: frames('left-sternal', 0.25),
      source: 'emulator',
      sourceDescriptor: 'test-emulator',
      hardwareProfileId: 'infineon-bgt60tr13c-emulator',
      calibrationFrameCount: 8,
    });
    const comparison = compareScannerReplays(
      replayScannerRecording(await scannerRecordingRepository.load(first.id)),
      replayScannerRecording(await scannerRecordingRepository.load(second.id)),
    );
    expect(comparison.profileCosineSimilarity).toBeGreaterThanOrEqual(0);
    expect(comparison.profileCosineSimilarity).toBeLessThanOrEqual(1);
    expect(comparison.warnings).toContain('Inspelningarna kommer från olika scannerpositioner.');
  });
});
