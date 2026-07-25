import type { WifiSensingAnalysis, WifiSensingRecordingManifest } from '@/domain/wifiSensing';

import { analyzeWifiCsiCapture } from './analysis';
import { deriveWifiCsiCalibration } from './calibration';
import {
  defaultWifiSensingConfiguration,
  SimulatedWifiSensingProvider,
  type WifiSensingProvider,
} from './provider';
import { wifiSensingRecordingRepository } from './recordingRepository';

export type WifiSensingLabResult = {
  manifest: WifiSensingRecordingManifest;
  analysis: WifiSensingAnalysis;
  calibrationQualityScore: number;
  recordingVerified: boolean;
};

export async function runWifiSensingLab(input: {
  provider?: WifiSensingProvider;
  label?: string;
} = {}): Promise<WifiSensingLabResult> {
  const provider = input.provider ?? new SimulatedWifiSensingProvider();
  await provider.connect();
  try {
    await provider.configure(defaultWifiSensingConfiguration);
    const capture = await provider.capture({
      id: `wifi-lab-${Date.now()}`,
      tags: ['wifi-csi', 'vital-motion'],
      notes: input.label ? [input.label] : [],
    });
    const manifest = await wifiSensingRecordingRepository.save(capture);
    const verifiedCapture = await wifiSensingRecordingRepository.load(manifest.id);
    const calibration = deriveWifiCsiCalibration(
      verifiedCapture.frames,
      verifiedCapture.calibrationSoundingCount,
    );
    const analysis = analyzeWifiCsiCapture(verifiedCapture, calibration);
    return {
      manifest,
      analysis,
      calibrationQualityScore: calibration.qualityScore,
      recordingVerified:
        verifiedCapture.frames.length === manifest.frameCount &&
        verifiedCapture.id === manifest.id,
    };
  } finally {
    await provider.disconnect();
  }
}