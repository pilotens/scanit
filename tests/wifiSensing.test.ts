import { beforeEach, describe, expect, it } from 'vitest';

import { analyzeWifiCsiCapture } from '@/services/scanner/wifi/analysis';
import { deriveWifiCsiCalibration } from '@/services/scanner/wifi/calibration';
import { runWifiSensingLab } from '@/services/scanner/wifi/labRunner';
import { decodeWifiCsiFrame, encodeWifiCsiFrame } from '@/services/scanner/wifi/protocol/wcs1Codec';
import { wifiSensingRecordingRepository } from '@/services/scanner/wifi/recordingRepository';
import { simulateWifiCsiCapture } from '@/services/scanner/wifi/simulator';

describe('Wi-Fi CSI vital sensing track', () => {
  beforeEach(async () => {
    await wifiSensingRecordingRepository.clear();
  });

  it('round-trips WCS1 and rejects corruption', () => {
    const frame = simulateWifiCsiCapture({ soundingCount: 40 }).frames[0]!;
    const packet = encodeWifiCsiFrame(frame);
    const decoded = decodeWifiCsiFrame(packet);
    expect(decoded.subcarrierIndices).toEqual(frame.subcarrierIndices);
    expect(decoded.csi).toEqual(Array.from(new Float32Array(frame.csi)));
    expect(decoded.soundingSequence).toBe(0);

    packet[Math.floor(packet.length / 2)]! ^= 0xff;
    expect(() => decodeWifiCsiFrame(packet)).toThrow(/CRC/);
  });

  it('calibrates multiple receiver links and separates periodic bands', () => {
    const capture = simulateWifiCsiCapture({
      soundingCount: 240,
      calibrationSoundingCount: 24,
      soundingRateHz: 20,
      multipathDriftScale: 0.04,
    });
    const calibration = deriveWifiCsiCalibration(
      capture.frames,
      capture.calibrationSoundingCount,
    );
    const analysis = analyzeWifiCsiCapture(capture, calibration);

    expect(calibration.links).toHaveLength(3);
    expect(calibration.qualityScore).toBeGreaterThanOrEqual(70);
    expect(analysis.qualityGate.verdict).toBe('approved');
    expect(analysis.qualityGate.estimatedSoundingRateHz).toBeCloseTo(20, 1);
    expect(analysis.receiverLinkCount).toBe(3);
    expect(analysis.respiratoryRateBpm).toBeGreaterThan(8);
    expect(analysis.respiratoryRateBpm).toBeLessThan(25);
    expect(analysis.mechanicalRateBpm).toBeGreaterThan(45);
    expect(analysis.mechanicalRateBpm).toBeLessThan(120);
    expect(analysis.respirationTrace.length).toBeGreaterThan(20);
    expect(analysis.mechanicalTrace.length).toBeGreaterThan(20);
    expect(analysis.multipathStability).toBeGreaterThan(0.55);
    expect(analysis.claims.find(({ id }) => id === 'anatomy')?.state).toBe('not-supported');
    expect(analysis.claims.find(({ id }) => id === 'coronary-artery')?.state).toBe('not-supported');
    expect(analysis.claims.find(({ id }) => id === 'ischemia-infarction')?.state).toBe('not-validated');
  });

  it('stores immutable WCS1 chunks and replays the same capture', async () => {
    const capture = simulateWifiCsiCapture({ id: 'wifi-recording-test', soundingCount: 80 });
    const manifest = await wifiSensingRecordingRepository.save(capture);
    const loaded = await wifiSensingRecordingRepository.load(manifest.id);
    const expectedCsi = Array.from(new Float32Array(capture.frames[12]!.csi));

    expect(manifest.aggregateCrc32).toMatch(/^[0-9a-f]{8}$/);
    expect(manifest.chunkCount).toBeGreaterThan(1);
    expect(loaded.frames).toHaveLength(capture.frames.length);
    expect(loaded.frames[12]?.csi).toEqual(expectedCsi);
    expect(loaded.frames[12]?.timing).toEqual(capture.frames[12]?.timing);
  });

  it('runs capture, encrypted replay, calibration and analysis end to end', async () => {
    const result = await runWifiSensingLab({ label: 'automated Wi-Fi CSI lab' });
    expect(result.recordingVerified).toBe(true);
    expect(result.calibrationQualityScore).toBeGreaterThanOrEqual(70);
    expect(result.analysis.qualityGate.verdict).toBe('approved');
    expect(result.analysis.version).toBe('wifi-csi-vitals-v1');
  });
});
