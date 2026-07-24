import type { PersonalBaseline, RiskAssessment, RiskLevel, SignalQuality } from '@/domain/health';
import type {
  RfObservation,
  RfPosition,
  ScanProgressEvent,
  ScanSession,
} from '@/domain/scanning';
import type { RfScannerProvider, WearableSensorProvider } from '@/services/sensors/types';

const positions: RfPosition[] = [
  'left-sternal',
  'apex',
  'right-reference',
  'upper-chest',
];

const labels: Record<RfPosition, string> = {
  'left-sternal': 'vänster om bröstbenet',
  apex: 'över hjärtspetsområdet',
  'right-reference': 'höger referensposition',
  'upper-chest': 'övre bröstområdet',
};

export type ScanCoordinatorDependencies = {
  wearable: WearableSensorProvider;
  rfScanner: RfScannerProvider;
  baseline: PersonalBaseline;
};

export type ScanCoordinatorOptions = {
  onProgress: (event: ScanProgressEvent) => void;
};

const qualityRank: Record<SignalQuality, number> = {
  poor: 0,
  fair: 1,
  good: 2,
  excellent: 3,
};

const rankToQuality = (rank: number): SignalQuality => {
  if (rank >= 2.75) return 'excellent';
  if (rank >= 1.75) return 'good';
  if (rank >= 0.75) return 'fair';
  return 'poor';
};

const deriveAssessment = (
  heartRateBpm: number | null,
  oxygenSaturationPercent: number | null,
  hrvRmssdMs: number | null,
  observations: RfObservation[],
  baseline: PersonalBaseline,
): RiskAssessment => {
  const heartRateDelta =
    heartRateBpm === null ? 0 : Math.abs(heartRateBpm - baseline.restingHeartRateBpm);
  const hrvDelta =
    hrvRmssdMs === null ? 0 : Math.max(0, baseline.hrvRmssdMs - hrvRmssdMs);
  const oxygenPenalty =
    oxygenSaturationPercent === null ? 0 : Math.max(0, 97 - oxygenSaturationPercent) * 8;
  const rfDelta = observations.length
    ? observations.reduce((sum, item) => sum + item.baselineDelta, 0) / observations.length
    : 0;

  const missingWearableValues = [heartRateBpm, oxygenSaturationPercent, hrvRmssdMs].filter(
    (value) => value === null,
  ).length;
  const rawScore = 12 + heartRateDelta * 1.4 + hrvDelta * 0.8 + oxygenPenalty + rfDelta * 120;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let level: RiskLevel = 'normal';
  if (score >= 75) level = 'urgent';
  else if (score >= 52) level = 'elevated';
  else if (score >= 30) level = 'observe';

  const titles: Record<RiskLevel, string> = {
    normal: 'Inga tydliga avvikelser i prototypdata',
    observe: 'Mindre avvikelse från personlig baslinje',
    elevated: 'Flera prototypsignaler avviker',
    urgent: 'Prototypmodellen markerar en tydlig avvikelse',
  };

  return {
    level,
    score,
    confidence: Math.max(0.35, 0.82 - missingWearableValues * 0.12),
    title: titles[level],
    summary:
      level === 'normal'
        ? 'Tillgängliga klock- och RF-signaler ligger nära den personliga baslinjen.'
        : 'Resultatet behöver kontrolleras med en ny mätning och får inte användas som diagnos.',
    evidence: [
      {
        id: 'heart-rate',
        label: 'Puls mot baslinje',
        value:
          heartRateBpm === null
            ? 'Mätvärde saknas'
            : `${heartRateBpm} bpm (${heartRateBpm - baseline.restingHeartRateBpm >= 0 ? '+' : ''}${heartRateBpm - baseline.restingHeartRateBpm})`,
        contribution:
          heartRateBpm === null ? 'neutral' : heartRateDelta > 15 ? 'concerning' : 'reassuring',
      },
      {
        id: 'oxygen',
        label: 'Syremättnad',
        value: oxygenSaturationPercent === null ? 'Mätvärde saknas' : `${oxygenSaturationPercent}%`,
        contribution:
          oxygenSaturationPercent === null
            ? 'neutral'
            : oxygenSaturationPercent < 95
              ? 'concerning'
              : 'reassuring',
      },
      {
        id: 'rf-delta',
        label: 'RF-förändring',
        value: `${Math.round(rfDelta * 100)}% relativ differens`,
        contribution: rfDelta > 0.16 ? 'concerning' : 'neutral',
      },
    ],
    generatedAt: new Date().toISOString(),
    medicalDisclaimer:
      'Forskningsprototyp. Resultatet kan inte diagnostisera eller utesluta hjärtinfarkt.',
  };
};

export class ScanCoordinator {
  constructor(private readonly dependencies: ScanCoordinatorDependencies) {}

  async run(options: ScanCoordinatorOptions): Promise<ScanSession> {
    const { wearable, rfScanner, baseline } = this.dependencies;
    const startedAt = new Date().toISOString();

    options.onProgress({
      phase: 'preparing',
      progress: 0.04,
      title: 'Kontrollerar sensorer',
      instruction: 'Sitt stilla och håll telefonen nära kroppen.',
    });

    await Promise.all([wearable.connect(), rfScanner.connect()]);

    options.onProgress({
      phase: 'calibrating',
      progress: 0.14,
      title: 'Kalibrerar RF-modulen',
      instruction: 'Håll modulen stilla utan att trycka hårt mot bröstet.',
    });
    await rfScanner.calibrate();

    options.onProgress({
      phase: 'wearable-baseline',
      progress: 0.25,
      title: 'Samlar klockans referensfönster',
      instruction: 'Andas normalt och undvik att prata.',
    });
    const wearableSnapshot = await wearable.collectBaselineWindow(8_000);

    const rfObservations: RfObservation[] = [];

    for (let index = 0; index < positions.length; index += 1) {
      const position = positions[index];
      if (!position) continue;

      options.onProgress({
        phase: 'rf-scan',
        progress: 0.34 + index * 0.12,
        title: `Skannar ${labels[position]}`,
        instruction: 'Följ positionen på skärmen och håll modulen stilla.',
        currentPosition: position,
      });
      rfObservations.push(await rfScanner.scanPosition(position, 5_000));
    }

    options.onProgress({
      phase: 'fusing',
      progress: 0.88,
      title: 'Sammanväger signalerna',
      instruction: 'Klock-, rörelse- och RF-data jämförs med din baslinje.',
    });

    const assessment = deriveAssessment(
      wearableSnapshot.heartRateBpm,
      wearableSnapshot.oxygenSaturationPercent,
      wearableSnapshot.hrvRmssdMs,
      rfObservations,
      baseline,
    );

    const averageQuality =
      (qualityRank[wearableSnapshot.signalQuality] +
        rfObservations.reduce((sum, item) => sum + qualityRank[item.signalQuality], 0)) /
      (rfObservations.length + 1);

    const completedAt = new Date().toISOString();
    const sessionIsSimulated =
      wearableSnapshot.isSimulated || rfObservations.some((observation) => observation.isSimulated);
    const session: ScanSession = {
      id: `scan-${Date.now()}`,
      startedAt,
      completedAt,
      phase: 'completed',
      wearableSnapshot,
      rfObservations,
      assessment,
      overallSignalQuality: rankToQuality(averageQuality),
      notes: [
        wearableSnapshot.source === 'healthkit'
          ? 'Klockvärden importerades från Apple Health och är inte synkroniserade råsignaler.'
          : 'Klockvärden kommer från simulatorn.',
        'RF-kartan beskriver relativ signalrespons, inte verifierad anatomi.',
      ],
      isSimulated: sessionIsSimulated,
    };

    options.onProgress({
      phase: 'completed',
      progress: 1,
      title: 'Skanningen är klar',
      instruction: 'Granska resultatet och signalkvaliteten.',
    });

    return session;
  }
}
