import { beforeEach, describe, expect, it } from 'vitest';

import type { ScannerReferenceEvent } from '@/domain/scannerTiming';
import { deriveRxCalibration } from '@/services/scanner/calibration/rxCalibration';
import { generateSyntheticRadioFrame } from '@/services/scanner/emulator/syntheticScanner';
import { computeBasicProfile } from '@/services/scanner/processing/profile';
import { scannerRecordingRepository } from '@/services/scanner/recording/recordingRepository';
import { replayScannerRecording } from '@/services/scanner/replay/replayEngine';
import { buildScannerClockModel } from '@/services/scanner/timing/clockModel';

const frameRateHz = 20;
const intervalNs = 50_000_000n;
const monotonicStartNs = 3_000_000_000_000_000n;
const wallStartNs = 1_950_000_000_000_000_000n;

const buildFrames = (count: number, calibrationFrames: number) =>
  Array.from({ length: count }, (_, sequence) => {
    const offsetNs = BigInt(sequence) * intervalNs;
    return generateSyntheticRadioFrame({
      sessionId: 'calibration-timing-test',
      sequence,
      position: 'apex',
      elapsedSeconds: sequence / frameRateHz,
      motionScale: sequence < calibrationFrames ? 0 : 1,
      rxGainScales: [1, 0.48, 1.65],
      rxPhaseOffsetsRadians: [0, 1.05, -0.82],
      clockDomain: 'test-scanner-clock',
      monotonicTimestampNs: String(monotonicStartNs + offsetNs),
      wallClockUnixNs: String(wallStartNs + offsetNs),
      timingUncertaintyNs: 150_000,
    });
  });

describe('scanner calibration, timing and coherent averaging', () => {
  beforeEach(async () => {
    await scannerRecordingRepository.clear();
  });

  it('derives explicit RX gain and phase corrections that improve coherence', () => {
    const frames = buildFrames(16, 16);
    const calibration = deriveRxCalibration(
      frames,
      'infineon-bgt60tr13c-emulator',
    );
    expect(calibration).toBeDefined();
    expect(calibration!.channels).toHaveLength(3);
    expect(calibration!.qualityScore).toBeGreaterThanOrEqual(60);
    expect(calibration!.coherenceAfter).toBeGreaterThan(
      calibration!.coherenceBefore,
    );

    const raw = computeBasicProfile(frames[0]!, calibration!.targetBin);
    const corrected = computeBasicProfile(
      frames[0]!,
      calibration!.targetBin,
      calibration,
    );
    expect(corrected.rxCalibrationApplied).toBe(true);
    expect(corrected.rxCoherence).toBeGreaterThan(raw.rxCoherence ?? 0);
  });

  it('fits a synchronized monotonic-to-wall-clock model with bounded drift', () => {
    const frames = Array.from({ length: 40 }, (_, sequence) => {
      const wallOffset = BigInt(sequence) * intervalNs;
      const monotonicOffset = BigInt(
        Math.round(Number(wallOffset) * 1.0001),
      );
      return generateSyntheticRadioFrame({
        sessionId: 'clock-drift-test',
        sequence,
        position: 'apex',
        elapsedSeconds: sequence / frameRateHz,
        motionScale: 0,
        clockDomain: 'drift-clock',
        monotonicTimestampNs: String(monotonicStartNs + monotonicOffset),
        wallClockUnixNs: String(wallStartNs + wallOffset),
        timingUncertaintyNs: 100_000,
      });
    });
    const model = buildScannerClockModel(frames);
    expect(model.status).toBe('synchronized');
    expect(model.anchorCount).toBe(40);
    expect(model.driftPpm).toBeCloseTo(100, 0);
    expect(model.estimatedMappingUncertaintyNs).toBeLessThan(1_000_000);
  });

  it('builds an event-locked mechanical average from explicit ECG R-peaks', async () => {
    const calibrationFrames = 20;
    const frames = buildFrames(280, calibrationFrames);
    const manifest = await scannerRecordingRepository.save({
      frames,
      source: 'emulator',
      sourceDescriptor: 'calibration-timing-test',
      hardwareProfileId: 'infineon-bgt60tr13c-emulator',
      calibrationFrameCount: calibrationFrames,
    });
    const referenceEvents: ScannerReferenceEvent[] = [];
    const beatPeriodSeconds = 1 / 1.18;
    for (let timeSeconds = 1.6; timeSeconds <= 12.2; timeSeconds += beatPeriodSeconds) {
      referenceEvents.push({
        id: `r-${referenceEvents.length}`,
        source: 'ecg-r-peak',
        timestampUnixNs: String(
          wallStartNs + BigInt(Math.round(timeSeconds * 1_000_000_000)),
        ),
        uncertaintyNs: 500_000,
        quality: 0.98,
        sourceDeviceId: 'synthetic-ecg',
      });
    }

    const replay = replayScannerRecording(
      await scannerRecordingRepository.load(manifest.id),
      { referenceEvents },
    );
    expect(replay.processingVersion).toBe('scanner-pipeline-v4');
    expect(replay.qualityGate.version).toBe('scanner-quality-v3');
    expect(replay.calibration.rxCalibration?.version).toBe(
      'scanner-rx-calibration-v1',
    );
    expect(replay.clockModel.status).toBe('synchronized');
    expect(replay.coherentAverage?.status).toBe('available');
    expect(replay.coherentAverage?.acceptedBeatCount).toBeGreaterThanOrEqual(6);
    expect(replay.coherentAverage?.beatCoherence).toBeGreaterThan(0.35);
    expect(
      replay.coherentAverage?.meanDisplacementMillimeters.length,
    ).toBeGreaterThan(10);
  });
});
