import type { ScannerCoreDiagnostic } from '@/domain/radio';

import { generateSyntheticRadioFrame } from './emulator/syntheticScanner';
import { ScannerSignalPipeline } from './processing/pipeline';
import { decodeRadioFrame, encodeRadioFrame } from './protocol/frameCodec';

export function runScannerCoreDiagnostic(): ScannerCoreDiagnostic {
  const sessionId = `diagnostic-${Date.now()}`;
  const position = 'apex' as const;
  const calibrationFrames = Array.from({ length: 12 }, (_, sequence) =>
    generateSyntheticRadioFrame({
      sessionId,
      sequence,
      position,
      elapsedSeconds: sequence / 20,
      motionScale: 0,
    }),
  );
  const pipeline = new ScannerSignalPipeline();
  pipeline.calibrate(calibrationFrames, 'infineon-bgt60tr13c');

  const activeFrames = Array.from({ length: 32 }, (_, index) =>
    generateSyntheticRadioFrame({
      sessionId,
      sequence: index + calibrationFrames.length,
      position,
      elapsedSeconds: index / 20,
      motionScale: 1,
    }),
  );
  const encoded = encodeRadioFrame(activeFrames[0]!);
  const decoded = decodeRadioFrame(encoded);
  const analyses = activeFrames.map((frame) => pipeline.process(frame));
  const ranges = analyses.flatMap(({ targetRangeMeters }) =>
    targetRangeMeters === undefined ? [] : [targetRangeMeters],
  );
  const displacements = analyses.flatMap(({ displacementMillimeters }) =>
    displacementMillimeters === undefined ? [] : [Math.abs(displacementMillimeters)],
  );
  const averageRange = ranges.reduce((sum, value) => sum + value, 0) / Math.max(ranges.length, 1);
  const peakDisplacement = Math.max(...displacements, 0);
  const averageSnr =
    analyses.reduce((sum, { signalToNoiseRatioDb }) => sum + signalToNoiseRatioDb, 0) /
    analyses.length;
  const checks = [
    {
      name: 'Binary frame round-trip',
      passed:
        decoded.sequence === activeFrames[0]!.sequence &&
        decoded.samples.length === activeFrames[0]!.samples.length,
      detail: `${encoded.length} byte med verifierad CRC32`,
    },
    {
      name: 'Range localization',
      passed: averageRange >= 0.2 && averageRange <= 0.5,
      detail: `${averageRange.toFixed(3)} m ekvivalent range`,
    },
    {
      name: 'Micro-motion extraction',
      passed: peakDisplacement > 0.001 && Number.isFinite(peakDisplacement),
      detail: `${peakDisplacement.toFixed(4)} mm största fasförändring per frame`,
    },
    {
      name: 'Signal quality',
      passed: averageSnr > 6,
      detail: `${averageSnr.toFixed(1)} dB genomsnittligt SNR`,
    },
  ];

  return {
    passed: checks.every(({ passed }) => passed),
    checks,
    targetRangeMeters: averageRange,
    peakDisplacementMillimeters: peakDisplacement,
    averageSignalToNoiseRatioDb: averageSnr,
    profile: analyses.at(-1)?.normalizedProfile.slice(0, 24) ?? [],
  };
}
