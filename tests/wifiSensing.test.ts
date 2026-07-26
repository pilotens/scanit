import { beforeEach, describe, expect, it } from 'vitest';

import { analyzeWifiCsiCapture } from '@/services/scanner/wifi/analysis';
import { deriveWifiCsiCalibration } from '@/services/scanner/wifi/calibration';
import { runWifiSensingLab } from '@/services/scanner/wifi/labRunner';
import { assessWifiCaptureProvenance } from '@/services/scanner/wifi/provenance';
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
    expect(decoded.soundingIdSource).toBe('transmitter-payload');
    expect(decoded.soundingSessionNonce).toBe(0x5343414e);

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
    expect(manifest.qualityFlags).toContain('simulated-provenance');
    expect(loaded.frames).toHaveLength(capture.frames.length);
    expect(loaded.frames[12]?.csi).toEqual(expectedCsi);
    expect(loaded.frames[12]?.timing).toEqual(capture.frames[12]?.timing);
  });

  it('preserves verified physical sounding provenance through encrypted replay', async () => {
    const capture = simulateWifiCsiCapture({ id: 'physical-provenance', soundingCount: 80 });
    capture.source = 'physical-test-rig';
    capture.hardwareProfileId = 'esp32-c5-csi-pair';
    capture.frames = capture.frames.map((frame) => ({
      ...frame,
      source: 'physical-test-rig',
      isSimulated: false,
    }));

    const assessment = assessWifiCaptureProvenance(capture.frames);
    expect(assessment.valid).toBe(true);
    expect(assessment.explicitFrameRatio).toBe(1);
    const manifest = await wifiSensingRecordingRepository.save(capture);
    const loaded = await wifiSensingRecordingRepository.load(manifest.id);

    expect(manifest.qualityFlags).toContain('physical-provenance-verified');
    expect(loaded.frames.every(({ soundingIdSource }) => soundingIdSource === 'transmitter-payload')).toBe(
      true,
    );
  });

  it('rejects imported physical replay that lacks SND1 identity', async () => {
    const capture = simulateWifiCsiCapture({ id: 'invalid-import', soundingCount: 80 });
    capture.source = 'imported-physical-data';
    capture.frames = capture.frames.map((frame) => ({
      ...frame,
      isSimulated: false,
      soundingIdSource: 'receiver-sequence-fallback',
      soundingSessionNonce: undefined,
      soundingMarkerDeltaMicroseconds: undefined,
    }));

    await expect(wifiSensingRecordingRepository.save(capture)).rejects.toThrow(/provenance failed/i);
  });

  it('runs capture, encrypted replay, calibration and analysis end to end', async () => {
    const result = await runWifiSensingLab({ label: 'automated Wi-Fi CSI lab' });
    expect(result.recordingVerified).toBe(true);
    expect(result.calibrationQualityScore).toBeGreaterThanOrEqual(70);
    expect(result.analysis.qualityGate.verdict).toBe('approved');
    expect(result.analysis.version).toBe('wifi-csi-vitals-v1');
  });
});
