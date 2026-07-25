import type {
  RawRadioFrame,
  ScannerCalibration,
  ScannerFrameAnalysis,
} from '@/domain/radio';

import { deriveRxCalibration } from '../calibration/rxCalibration';
import { clamp, mean, standardDeviation, wrapPhase } from '../math/complex';
import { computeBasicProfile } from './profile';

const SPEED_OF_LIGHT_METERS_PER_SECOND = 299_792_458;

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
};

const qualityFromSnr = (
  snr: number,
  motionPenalty: number,
  coherencePenalty: number,
): ScannerFrameAnalysis['signalQuality'] => {
  const adjusted = snr - motionPenalty - coherencePenalty;
  if (adjusted >= 18) return 'excellent';
  if (adjusted >= 11) return 'good';
  if (adjusted >= 6) return 'fair';
  return 'poor';
};

export class ScannerSignalPipeline {
  private calibration?: ScannerCalibration;
  private previousPhase?: number;

  calibrate(frames: RawRadioFrame[], hardwareProfileId: string): ScannerCalibration {
    if (frames.length < 4) throw new Error('At least four frames are required for calibration.');
    const rxCalibration = deriveRxCalibration(frames, hardwareProfileId);
    const profiles = frames.map((frame) =>
      computeBasicProfile(frame, undefined, rxCalibration),
    );
    const length = Math.min(...profiles.map(({ profile }) => profile.length));
    const profile = Array.from({ length }, (_, index) =>
      mean(profiles.map((item) => item.profile[index] ?? 0)),
    );
    const noiseFloor = median(profile.slice(Math.max(1, Math.floor(length * 0.6))));
    const first = frames[0]!;

    this.calibration = {
      id: `cal-${Date.now()}-${first.position}`,
      modality: first.modality,
      createdAt: new Date().toISOString(),
      position: first.position,
      frameCount: frames.length,
      profile,
      noiseFloor,
      hardwareProfileId,
      rxCalibration,
    };
    this.previousPhase = undefined;
    return this.calibration;
  }

  getCalibration() {
    return this.calibration;
  }

  process(frame: RawRadioFrame, targetBinOverride?: number): ScannerFrameAnalysis {
    const rxCalibration = this.calibration?.rxCalibration;
    const basic = computeBasicProfile(frame, targetBinOverride, rxCalibration);
    const baseline = this.calibration?.profile ?? basic.profile.map(() => 0);
    const length = Math.min(basic.profile.length, baseline.length);
    const baselineDeltaProfile = Array.from({ length }, (_, index) =>
      Math.abs((basic.profile[index] ?? 0) - (baseline[index] ?? 0)),
    );
    const targetBin = basic.targetBin;
    const targetMagnitude = basic.profile[targetBin] ?? 0;
    const noiseValues = basic.profile.filter((_, index) => Math.abs(index - targetBin) > 2);
    const noise = Math.max(median(noiseValues), 1e-6);
    const signalToNoiseRatioDb = 20 * Math.log10(Math.max(targetMagnitude, 1e-6) / noise);

    const phaseDeltaRadians =
      basic.targetPhaseRadians !== undefined && this.previousPhase !== undefined
        ? wrapPhase(basic.targetPhaseRadians - this.previousPhase)
        : undefined;
    if (basic.targetPhaseRadians !== undefined) this.previousPhase = basic.targetPhaseRadians;

    const wavelength = frame.centerFrequencyHz > 0
      ? SPEED_OF_LIGHT_METERS_PER_SECOND / frame.centerFrequencyHz
      : undefined;
    const displacementMillimeters =
      phaseDeltaRadians !== undefined && wavelength
        ? (phaseDeltaRadians * wavelength * 1000) / (4 * Math.PI)
        : undefined;

    const acceleration = frame.imu?.acceleration;
    const motionPenalty = acceleration
      ? Math.hypot(acceleration.x, acceleration.y, acceleration.z) * 30
      : 0;
    const coherencePenalty =
      (basic.chirpCoherence === undefined ? 0 : Math.max(0, 0.55 - basic.chirpCoherence) * 12) +
      (basic.rxCoherence === undefined ? 0 : Math.max(0, 0.25 - basic.rxCoherence) * 8);
    const motionScore = clamp(
      mean(baselineDeltaProfile) * 4 + Math.abs(displacementMillimeters ?? 0) / 2,
    );
    const targetConfidence = clamp(
      Math.min(1, Math.max(0, signalToNoiseRatioDb / 20)) * 0.4 +
        (basic.chirpCoherence ?? 0.5) * 0.3 +
        (basic.rxCoherence ?? 0.5) * 0.2 +
        (basic.rxCalibrationQualityScore === undefined
          ? 0.05
          : basic.rxCalibrationQualityScore / 100) * 0.1,
    );
    const qualityFlags = [...frame.qualityFlags];
    if (motionPenalty > 4) qualityFlags.push('device-motion');
    if (signalToNoiseRatioDb < 6) qualityFlags.push('low-snr');
    if (standardDeviation(frame.samples) < 1e-5) qualityFlags.push('flat-signal');
    if (basic.chirpCoherence !== undefined && basic.chirpCoherence < 0.35) {
      qualityFlags.push('low-chirp-coherence');
    }
    if (basic.rxCoherence !== undefined && basic.rxCoherence < 0.2) {
      qualityFlags.push('low-rx-coherence');
    }
    if (frame.modality === 'mmwave-fmcw' && frame.channels > 1 && !basic.rxCalibrationApplied) {
      qualityFlags.push('rx-calibration-missing');
    }
    if ((basic.rxCalibrationQualityScore ?? 100) < 60) {
      qualityFlags.push('rx-calibration-low-quality');
    }
    if (
      frame.acquisition?.chirpsPerFrame &&
      frame.acquisition.chirpsPerFrame > 1 &&
      frame.acquisition.chirpReduction !== 'none'
    ) {
      qualityFlags.push('chirp-information-lost');
    }
    if (
      basic.targetRangeMeters !== undefined &&
      basic.targetRangeMeters < 0.2 &&
      frame.antennaConfigurationId.includes('bgt60tr13c')
    ) {
      qualityFlags.push('near-field-unvalidated');
    }
    const timingUncertaintyMilliseconds = frame.timing
      ? frame.timing.uncertaintyNs / 1_000_000
      : undefined;
    if (timingUncertaintyMilliseconds !== undefined && timingUncertaintyMilliseconds > 20) {
      qualityFlags.push('timestamp-uncertainty-high');
    }

    return {
      sequence: frame.sequence,
      modality: frame.modality,
      targetBin,
      targetRangeMeters: basic.targetRangeMeters,
      normalizedProfile: basic.profile,
      baselineDeltaProfile,
      phaseRadians: basic.targetPhaseRadians,
      phaseDeltaRadians,
      displacementMillimeters,
      motionScore,
      signalToNoiseRatioDb,
      signalQuality: qualityFromSnr(signalToNoiseRatioDb, motionPenalty, coherencePenalty),
      qualityFlags: [...new Set(qualityFlags)],
      rxCoherence: basic.rxCoherence,
      rxCoherenceBeforeCalibration: basic.rxCoherenceBeforeCalibration,
      chirpCoherence: basic.chirpCoherence,
      targetConfidence,
      targetBinTracked: targetBinOverride !== undefined,
      rxCalibrationApplied: basic.rxCalibrationApplied,
      rxCalibrationQualityScore: basic.rxCalibrationQualityScore,
      timingUncertaintyMilliseconds,
    };
  }
}
