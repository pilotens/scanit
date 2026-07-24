import type { RfObservation, RfPosition } from '@/domain/scanning';
import { generateSyntheticRadioFrame } from '@/services/scanner/emulator/syntheticScanner';
import { mean, standardDeviation } from '@/services/scanner/math/complex';
import { ScannerSignalPipeline } from '@/services/scanner/processing/pipeline';

import type { RfScannerProvider } from './types';

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs));

const qualityRank = { poor: 0, fair: 1, good: 2, excellent: 3 } as const;
const qualities = ['poor', 'fair', 'good', 'excellent'] as const;

export class MockRfScannerProvider implements RfScannerProvider {
  readonly id = 'rf-core-emulator';
  private pipeline = new ScannerSignalPipeline();
  private sessionId = `rf-${Date.now()}`;
  private sequence = 0;

  async connect() {
    await wait(120);
    return {
      connected: true,
      batteryPercent: 74,
      lastSeenAt: new Date().toISOString(),
    };
  }

  async calibrate() {
    const frames = Array.from({ length: 12 }, (_, index) =>
      generateSyntheticRadioFrame({
        sessionId: this.sessionId,
        sequence: this.sequence++,
        position: 'right-reference',
        elapsedSeconds: index / 20,
        motionScale: 0,
      }),
    );
    this.pipeline.calibrate(frames, 'infineon-bgt60tr13c');
    await wait(160);
  }

  async scanPosition(position: RfPosition, durationMs: number): Promise<RfObservation> {
    const frameCount = Math.max(16, Math.min(64, Math.round(durationMs / 100)));
    const analyses = Array.from({ length: frameCount }, (_, index) => {
      const frame = generateSyntheticRadioFrame({
        sessionId: this.sessionId,
        sequence: this.sequence++,
        position,
        elapsedSeconds: index / 20,
        motionScale: 1,
      });
      return this.pipeline.process(frame);
    });
    const displacement = analyses.flatMap(({ displacementMillimeters }) =>
      displacementMillimeters === undefined ? [] : [displacementMillimeters],
    );
    const averageQuality = mean(analyses.map(({ signalQuality }) => qualityRank[signalQuality]));
    const signalQuality = qualities[Math.max(0, Math.min(3, Math.round(averageQuality)))]!;
    const displacementSpread = standardDeviation(displacement);
    const mechanicalRegularity = Math.max(0, Math.min(1, 1 - displacementSpread / 0.15));
    const relativeReflectivity = mean(
      analyses.map(({ normalizedProfile, targetBin }) => normalizedProfile[targetBin] ?? 0),
    );
    const baselineDelta = mean(
      analyses.map(({ baselineDeltaProfile }) => mean(baselineDeltaProfile)),
    );

    await wait(Math.min(durationMs, 320));
    return {
      position,
      signalQuality,
      mechanicalRegularity,
      relativeReflectivity,
      baselineDelta,
      sampleCount: frameCount * 3 * 64,
      isSimulated: true,
    };
  }
}
