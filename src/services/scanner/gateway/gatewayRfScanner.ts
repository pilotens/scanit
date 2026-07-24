import type { ScannerFrameAnalysis } from '@/domain/radio';
import type { RfObservation, RfPosition } from '@/domain/scanning';
import { ScannerSignalPipeline } from '@/services/scanner/processing/pipeline';
import type { RfScannerProvider, SensorHealth } from '@/services/sensors/types';

import { ScannerGatewayClient } from './scannerGatewayClient';
import { defaultGatewayFmcwConfiguration, type GatewayFmcwConfiguration } from './types';

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const standardDeviation = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

const qualityRank = { poor: 0, fair: 1, good: 2, excellent: 3 } as const;
const rankQuality = (rank: number): RfObservation['signalQuality'] => {
  if (rank >= 2.5) return 'excellent';
  if (rank >= 1.5) return 'good';
  if (rank >= 0.5) return 'fair';
  return 'poor';
};

export class GatewayRfScannerProvider implements RfScannerProvider {
  readonly id = 'bgt60tr13c-gateway';
  private readonly client: ScannerGatewayClient;
  private readonly configuration: GatewayFmcwConfiguration;

  constructor(url: string, configuration = defaultGatewayFmcwConfiguration) {
    this.client = new ScannerGatewayClient(url);
    this.configuration = configuration;
  }

  async connect(): Promise<SensorHealth> {
    const status = await this.client.connect();
    return {
      connected: status.deviceConnected,
      lastSeenAt: new Date().toISOString(),
    };
  }

  async calibrate(): Promise<void> {
    await this.client.configure(this.configuration);
    await this.client.calibrate();
  }

  async scanPosition(position: RfPosition, durationMs: number): Promise<RfObservation> {
    const sessionId = `physical-${Date.now()}-${position}`;
    const frames = [];
    await this.client.startStream(sessionId, position);
    const deadline = Date.now() + Math.max(1_000, durationMs);
    try {
      while (Date.now() < deadline && frames.length < 100) {
        try {
          frames.push(await this.client.nextFrame(Math.min(3_000, Math.max(500, deadline - Date.now()))));
        } catch (error) {
          if (frames.length >= 8) break;
          throw error;
        }
      }
    } finally {
      await this.client.stopStream().catch(() => undefined);
    }

    if (frames.length < 8) {
      throw new Error(`För få radarframes mottogs (${frames.length}). Minst åtta krävs.`);
    }
    const calibrationCount = Math.max(4, Math.min(10, Math.floor(frames.length / 4)));
    const pipeline = new ScannerSignalPipeline();
    pipeline.calibrate(frames.slice(0, calibrationCount), 'infineon-bgt60tr13c');
    const analyses = frames.slice(calibrationCount).map((frame) => pipeline.process(frame));
    return summarizeAnalyses(position, frames.length, analyses);
  }

  disconnect() {
    this.client.disconnect();
  }
}

export function summarizeAnalyses(
  position: RfPosition,
  frameCount: number,
  analyses: ScannerFrameAnalysis[],
): RfObservation {
  if (!analyses.length) throw new Error('No physical scanner analyses were produced.');
  const displacements = analyses
    .map(({ displacementMillimeters }) => displacementMillimeters)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const displacementSpread = standardDeviation(displacements);
  const regularity = Math.max(0, Math.min(1, 1 - displacementSpread / 1.5));
  const reflectivity = mean(
    analyses.map((analysis) => analysis.normalizedProfile[analysis.targetBin] ?? 0),
  );
  const baselineDelta = mean(
    analyses.map((analysis) => mean(analysis.baselineDeltaProfile)),
  );
  const averageQuality = mean(
    analyses.map((analysis) => qualityRank[analysis.signalQuality]),
  );

  return {
    position,
    signalQuality: rankQuality(averageQuality),
    mechanicalRegularity: regularity,
    relativeReflectivity: reflectivity,
    baselineDelta,
    sampleCount: frameCount,
    isSimulated: false,
  };
}
