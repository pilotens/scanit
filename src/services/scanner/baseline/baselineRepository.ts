import type { ScannerReplayResult } from '@/domain/scannerLab';
import type {
  ScannerBaselineComparison,
  ScannerBaselineSource,
  ScannerPersonalBaseline,
} from '@/domain/scannerSignal';
import { encryptedStorage } from '@/services/storage/encryptedStorage';

const BASELINE_PREFIX = 'scanner.baseline.v1.';
const MAX_SOURCES = 12;

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const standardDeviation = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

const scalarValues = (
  sources: ScannerBaselineSource[],
  selector: (source: ScannerBaselineSource) => number | undefined,
) => sources.flatMap((source) => {
  const value = selector(source);
  return value === undefined || !Number.isFinite(value) ? [] : [value];
});

const meanProfile = (sources: ScannerBaselineSource[]) => {
  const length = Math.min(...sources.map(({ profile }) => profile.length));
  if (!Number.isFinite(length) || length <= 0) return [];
  return Array.from({ length }, (_, index) =>
    mean(sources.map(({ profile }) => profile[index] ?? 0)),
  );
};

const baselineId = (replay: ScannerReplayResult) =>
  `${replay.manifest.hardwareProfileId}.${replay.manifest.modality}.${replay.manifest.position}`;

const key = (id: string) => `${BASELINE_PREFIX}${id}`;

const buildBaseline = (
  id: string,
  sources: ScannerBaselineSource[],
  replay: ScannerReplayResult,
  createdAt?: string,
): ScannerPersonalBaseline => {
  const ranges = scalarValues(sources, ({ averageTargetRangeMeters }) => averageTargetRangeMeters);
  const peaks = scalarValues(sources, ({ peakDisplacementMillimeters }) => peakDisplacementMillimeters);
  const snrValues = scalarValues(sources, ({ averageSignalToNoiseRatioDb }) => averageSignalToNoiseRatioDb);
  const cardiacRates = scalarValues(sources, ({ cardiacMechanicalRateBpm }) => cardiacMechanicalRateBpm);
  return {
    schemaVersion: 1,
    id,
    createdAt: createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    position: replay.manifest.position,
    modality: replay.manifest.modality,
    hardwareProfileId: replay.manifest.hardwareProfileId,
    sourceCount: sources.length,
    sourceRecordingIds: sources.map(({ recordingId }) => recordingId),
    profileMean: meanProfile(sources),
    averageTargetRangeMeters: ranges.length ? mean(ranges) : undefined,
    rangeStandardDeviationMeters: ranges.length > 1 ? standardDeviation(ranges) : undefined,
    peakDisplacementMeanMillimeters: mean(peaks),
    peakDisplacementStandardDeviationMillimeters: standardDeviation(peaks),
    averageSignalToNoiseRatioDb: mean(snrValues),
    cardiacMechanicalRateMeanBpm: cardiacRates.length ? mean(cardiacRates) : undefined,
    cardiacMechanicalRateStandardDeviationBpm:
      cardiacRates.length > 1 ? standardDeviation(cardiacRates) : undefined,
    sources,
  };
};

const cosineSimilarity = (left: number[], right: number[]) => {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue ** 2;
    rightNorm += rightValue ** 2;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator > 0 ? Math.max(-1, Math.min(1, dot / denominator)) : 0;
};

export function compareReplayToPersonalBaseline(
  baseline: ScannerPersonalBaseline,
  replay: ScannerReplayResult,
): ScannerBaselineComparison {
  const warnings: string[] = [];
  const compatible =
    baseline.position === replay.manifest.position &&
    baseline.modality === replay.manifest.modality &&
    baseline.hardwareProfileId === replay.manifest.hardwareProfileId;
  if (!compatible) warnings.push('Kandidaten matchar inte baslinjens position, radioteknik och hårdvara.');
  if (baseline.sourceCount < 3) warnings.push('Baslinjen är preliminär och innehåller färre än tre godkända mätningar.');
  if (replay.qualityGate.verdict !== 'approved') {
    warnings.push('Kandidatens signalkvalitet är inte godkänd.');
  }

  const profileCosineSimilarity = cosineSimilarity(baseline.profileMean, replay.profile);
  const candidateRange = replay.summary.averageTargetRangeMeters;
  const rangeDeviationMillimeters =
    baseline.averageTargetRangeMeters !== undefined && candidateRange !== undefined
      ? Math.abs(candidateRange - baseline.averageTargetRangeMeters) * 1000
      : undefined;
  const peakDisplacementDeviationMillimeters = Math.abs(
    replay.summary.peakDisplacementMillimeters - baseline.peakDisplacementMeanMillimeters,
  );
  const snrDeviationDb =
    replay.summary.averageSignalToNoiseRatioDb - baseline.averageSignalToNoiseRatioDb;
  const candidateCardiacRate = replay.physiology.cardiacMechanicalRateBpm;
  const cardiacRateDeviationBpm =
    baseline.cardiacMechanicalRateMeanBpm !== undefined && candidateCardiacRate !== undefined
      ? Math.abs(candidateCardiacRate - baseline.cardiacMechanicalRateMeanBpm)
      : undefined;

  let classification: ScannerBaselineComparison['classification'];
  if (!compatible || replay.qualityGate.verdict !== 'approved') {
    classification = 'insufficient-quality';
  } else if (
    profileCosineSimilarity < 0.82 ||
    (rangeDeviationMillimeters ?? 0) > 30 ||
    peakDisplacementDeviationMillimeters > 1 ||
    (cardiacRateDeviationBpm ?? 0) > 20
  ) {
    classification = 'significant-change';
  } else if (
    profileCosineSimilarity < 0.94 ||
    (rangeDeviationMillimeters ?? 0) > 10 ||
    peakDisplacementDeviationMillimeters > 0.35 ||
    (cardiacRateDeviationBpm ?? 0) > 10 ||
    Math.abs(snrDeviationDb) > 6
  ) {
    classification = 'changed';
  } else {
    classification = 'within-baseline';
  }

  return {
    baselineId: baseline.id,
    candidateRecordingId: replay.recordingId,
    compatible,
    profileCosineSimilarity,
    rangeDeviationMillimeters,
    peakDisplacementDeviationMillimeters,
    snrDeviationDb,
    cardiacRateDeviationBpm,
    classification,
    warnings,
  };
}

export const scannerBaselineRepository = {
  async list(): Promise<ScannerPersonalBaseline[]> {
    const records = await encryptedStorage.list<ScannerPersonalBaseline>(BASELINE_PREFIX);
    return records
      .map(({ value }) => value)
      .filter(({ schemaVersion }) => schemaVersion === 1)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  },

  async getCompatible(replay: ScannerReplayResult): Promise<ScannerPersonalBaseline | null> {
    return encryptedStorage.get<ScannerPersonalBaseline>(key(baselineId(replay)));
  },

  async addReplay(replay: ScannerReplayResult): Promise<ScannerPersonalBaseline> {
    if (replay.qualityGate.verdict !== 'approved') {
      throw new Error('Endast tekniskt godkända scannerinspelningar får läggas till i baslinjen.');
    }
    const id = baselineId(replay);
    const existing = await encryptedStorage.get<ScannerPersonalBaseline>(key(id));
    const source: ScannerBaselineSource = {
      recordingId: replay.recordingId,
      createdAt: replay.manifest.createdAt,
      profile: replay.profile,
      averageTargetRangeMeters: replay.summary.averageTargetRangeMeters,
      peakDisplacementMillimeters: replay.summary.peakDisplacementMillimeters,
      averageSignalToNoiseRatioDb: replay.summary.averageSignalToNoiseRatioDb,
      respiratoryRateBpm: replay.physiology.respiratoryRateBpm,
      cardiacMechanicalRateBpm: replay.physiology.cardiacMechanicalRateBpm,
      qualityScore: replay.qualityGate.score,
    };
    const retained = (existing?.sources ?? []).filter(
      ({ recordingId }) => recordingId !== replay.recordingId,
    );
    const sources = [...retained, source]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-MAX_SOURCES);
    const baseline = buildBaseline(id, sources, replay, existing?.createdAt);
    await encryptedStorage.set(key(id), baseline);
    return baseline;
  },

  async remove(id: string): Promise<void> {
    await encryptedStorage.remove(key(id));
  },

  async clear(): Promise<void> {
    const baselines = await this.list();
    await Promise.all(baselines.map(({ id }) => this.remove(id)));
  },
};
