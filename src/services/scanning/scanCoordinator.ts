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
  heartRateBpm: number,
  oxygenSaturationPercent: number,
  hrvRmssdMs: number,
  observations: RfObservation[],
  baseline: PersonalBaseline,
): RiskAssessment => {
  const heartRateDelta = Math.abs(heartRateBpm - baseline.restingHeartRateBpm);
  const hrvDelta = Math.max(0, baseline.hrvRmssdMs - hrvRmssdMs);
  const oxygenPenalty = Math.max(0, 97 - oxygenSaturationPercent) * 8;
  const rfDelta = observations.length
    ? observations.reduce((sum, item) => sum + item.baselineDelta, 0) / observations.length
    : 0;

  const rawScore = 12 + heartRateDelta * 1.4 + hrvDelta * 0.8 + oxygenPenalty + rfDelta * 120;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let level: RiskLevel = 'normal';
  if (score >= 75) level = 'urgent';
  else if (score >= 52) level = 'elevated';
  else if (score >= 30) level = 'observe';

  const titles: Record<RiskLevel, string> = {
    normal: 'Inga tydliga avvikelser i demodata',
    observe: 'Mindre avvikelse från simulerad baslinje',
    elevated: 'Flera simulerade signaler avviker',
    urgent: 'Demomodellen markerar en tydlig avvikelse',
  };

  return {
    level,
    score,
    confidence: 0.82,
    title: titles[level],
    summary:
      level === 'normal'
        ? 'Klock- och RF-signalerna ligger nära den simulerade personliga baslinjen.'
        : 'Resultatet behöver kontrolleras med en ny mätning och får inte användas som diagnos.',
    evidence: [
      {
        id: 'heart-rate',
        label: 'Puls mot baslinje',
        value: `${heartRateBpm} bpm (${heartRateDelta >= 1 ? '+' : ''}${heartRateBpm - baseline.restingHeartRateBpm})`,
        contribution: heartRateDelta > 15 ? 'concerning' : 'reassuring',
      },
      {
        id: 'oxygen',
        label: 'Syremättnad',
        value: `${oxygenSaturationPercent}%`,
        contribution: oxygenSaturationPercent < 95 ? 'concerning' : 'reassuring',
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
      'Prototyp med simulerade data. Resultatet kan inte diagnostisera eller utesluta hjärtinfarkt.',
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
        'All sensorvärden i denna version är simulerade.',
        'RF-kartan beskriver relativ signalrespons, inte verifierad anatomi.',
      ],
      isSimulated: true,
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
