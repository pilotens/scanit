import type { RawRadioFrame, ScannerFrameAnalysis } from '@/domain/radio';
import type { ScannerInterpretation, ScannerEvidenceClaim } from '@/domain/scannerInterpretation';
import type { ScannerPhysiologicalSeparation, ScannerSignalQualityGate } from '@/domain/scannerSignal';
import type { ScannerTargetTrack } from '@/services/scanner/processing/targetTracking';

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function interpretScannerEvidence(input: {
  frames: RawRadioFrame[];
  analyses: ScannerFrameAnalysis[];
  qualityGate: ScannerSignalQualityGate;
  physiology: ScannerPhysiologicalSeparation;
  targetTrack: ScannerTargetTrack;
}): ScannerInterpretation {
  const { frames, analyses, qualityGate, physiology, targetTrack } = input;
  const chirpCoherence = mean(
    analyses.flatMap((analysis) =>
      analysis.chirpCoherence === undefined ? [] : [analysis.chirpCoherence],
    ),
  );
  const rxCoherence = mean(
    analyses.flatMap((analysis) =>
      analysis.rxCoherence === undefined ? [] : [analysis.rxCoherence],
    ),
  );
  const targetConfidence = mean(
    analyses.flatMap((analysis) =>
      analysis.targetConfidence === undefined ? [] : [analysis.targetConfidence],
    ),
  );
  const rawCubeRatio = frames.length
    ? frames.filter(
        (frame) =>
          frame.dataLayout === 'rx-chirp-sample' &&
          (frame.acquisition?.chirpsPerFrame ?? 0) > 1 &&
          frame.acquisition?.chirpReduction === 'none',
      ).length / frames.length
    : 0;
  const nearField = analyses.some((analysis) =>
    analysis.qualityFlags.includes('near-field-unvalidated'),
  );

  const claims: ScannerEvidenceClaim[] = [];
  claims.push({
    id: 'raw-acquisition',
    label: 'Rå mätinformation',
    level: rawCubeRatio >= 0.98 ? 'supported' : rawCubeRatio >= 0.8 ? 'weak' : 'blocked',
    confidence: rawCubeRatio,
    statement:
      rawCubeRatio >= 0.98
        ? 'RX-, chirp- och ADC-dimensionerna finns kvar för fysisk signalbehandling.'
        : 'En del av chirpstrukturen saknas eller har reducerats före analys.',
    supportingMetrics: [{ label: 'Bevarade råkuber', value: rawCubeRatio * 100, unit: '%' }],
    caveats: ['Rådata visar elektromagnetisk respons, inte anatomisk identitet.'],
  });
  claims.push({
    id: 'physical-target',
    label: 'Stabilt reflektionsmål',
    level:
      nearField || qualityGate.verdict === 'rejected'
        ? 'blocked'
        : targetTrack.confidence >= 0.45 && targetTrack.binStandardDeviation <= 1.5
          ? 'supported'
          : 'weak',
    confidence: nearField
      ? 0
      : clamp(targetTrack.confidence * 0.55 + targetConfidence * 0.25 + chirpCoherence * 0.2),
    statement: nearField
      ? 'Målet ligger i en ännu ovaliderad närfältszon för 60 GHz-spåret.'
      : 'Systemet har följt ett återkommande range-mål över mätningen.',
    supportingMetrics: [
      { label: 'Spårningsförtroende', value: targetTrack.confidence * 100, unit: '%' },
      { label: 'Binvariation', value: targetTrack.binStandardDeviation, unit: 'bin' },
      { label: 'Målförtroende', value: targetConfidence * 100, unit: '%' },
    ],
    caveats: [
      'Ett stabilt reflektionsmål är inte automatiskt hjärtat.',
      'Position, kläder, revben och omgivningsreflexer kan bidra till samma mål.',
    ],
  });
  claims.push({
    id: 'coherent-motion',
    label: 'Koherent mikrorörelse',
    level:
      qualityGate.verdict === 'rejected'
        ? 'blocked'
        : chirpCoherence >= 0.55 && targetConfidence >= 0.5
          ? 'supported'
          : 'weak',
    confidence: clamp(chirpCoherence * 0.6 + rxCoherence * 0.15 + targetConfidence * 0.25),
    statement: 'Fasförändringarna är förenliga med mekanisk rörelse hos det spårade reflektionsmålet.',
    supportingMetrics: [
      { label: 'Chirpkoherens', value: chirpCoherence * 100, unit: '%' },
      { label: 'RX-koherens', value: rxCoherence * 100, unit: '%' },
    ],
    caveats: ['Rörelsen kan innehålla andning, kroppsrörelse, sensorvibration eller hjärtmekanik.'],
  });
  claims.push({
    id: 'respiratory-periodicity',
    label: 'Periodisk rörelse i andningsband',
    level:
      qualityGate.verdict === 'rejected'
        ? 'blocked'
        : physiology.respiratoryRateBpm && physiology.separationConfidence >= 0.2
          ? 'supported'
          : 'weak',
    confidence: clamp(physiology.separationConfidence),
    statement: physiology.respiratoryRateBpm
      ? `En periodisk RF-rörelsekomponent har uppskattats till ${physiology.respiratoryRateBpm.toFixed(1)} cykler/min.`
      : 'Ingen stabil periodisk komponent i andningsbandet kunde beläggas.',
    supportingMetrics: [
      { label: 'Separationsförtroende', value: physiology.separationConfidence * 100, unit: '%' },
    ],
    caveats: ['Detta är inte en medicinskt validerad andningsfrekvens.'],
  });
  claims.push({
    id: 'cardiac-periodicity',
    label: 'Periodisk rörelse i mekaniskt hjärtband',
    level:
      qualityGate.verdict === 'rejected'
        ? 'blocked'
        : physiology.reliable && physiology.cardiacMechanicalRateBpm
          ? 'supported'
          : 'weak',
    confidence: clamp(
      physiology.separationConfidence *
        (physiology.spectralAutocorrelationAgreement ?? 0.5) *
        (1 - (physiology.respirationHarmonicRisk ?? 0)),
    ),
    statement: physiology.cardiacMechanicalRateBpm
      ? `En periodisk RF-rörelsekomponent har uppskattats till ${physiology.cardiacMechanicalRateBpm.toFixed(1)} cykler/min.`
      : 'Ingen tillräckligt stabil mekanisk komponent i hjärtbandet kunde beläggas.',
    supportingMetrics: [
      {
        label: 'Spektrum–autokorrelation',
        value: (physiology.spectralAutocorrelationAgreement ?? 0) * 100,
        unit: '%',
      },
      {
        label: 'Risk för andningsharmonisk',
        value: (physiology.respirationHarmonicRisk ?? 0) * 100,
        unit: '%',
      },
    ],
    caveats: [
      'RF-periodiciteten är inte samma sak som ett EKG-verifierat hjärtslag.',
      'Andningsharmoniska kan ligga i samma frekvensband.',
    ],
  });
  claims.push({
    id: 'tissue-identity',
    label: 'Vävnadsidentifiering',
    level: 'unsupported',
    confidence: 0,
    statement: '60 GHz-mätningen identifierar inte blod, fett, muskel eller ett kranskärl.',
    supportingMetrics: [],
    caveats: ['Vävnadsrespons kräver ett separat bredbandigt UWB-/tomografispår och fysisk validering.'],
  });
  claims.push({
    id: 'medical-condition',
    label: 'Medicinsk tolkning',
    level: 'unsupported',
    confidence: 0,
    statement: 'Skanningen kan inte diagnostisera eller utesluta hjärtinfarkt eller ischemi.',
    supportingMetrics: [],
    caveats: ['Klinisk tolkning kräver synkroniserade referensdata och prospektiv validering.'],
  });

  const blockedReasons = [
    ...(qualityGate.verdict === 'rejected' ? qualityGate.reasons : []),
    ...(nearField ? ['60 GHz-målet ligger närmare än 20 cm och är ännu inte validerat.'] : []),
  ];
  const physicalClaim = claims.find(({ id }) => id === 'physical-target')!;
  const periodicClaim = claims.find(({ id }) => id === 'cardiac-periodicity')!;
  const acquisitionState =
    qualityGate.verdict === 'approved' ? 'valid' : qualityGate.verdict === 'repeat' ? 'repeat' : 'invalid';
  const physicalTargetState =
    physicalClaim.level === 'supported'
      ? 'supported'
      : physicalClaim.level === 'weak'
        ? 'uncertain'
        : 'unsupported';
  const periodicMotionState =
    periodicClaim.level === 'supported'
      ? 'supported'
      : periodicClaim.level === 'weak'
        ? 'uncertain'
        : 'unsupported';
  const overallConfidence = clamp(
    (qualityGate.score / 100) * 0.4 + physicalClaim.confidence * 0.35 + periodicClaim.confidence * 0.25,
  );

  return {
    version: 'scanner-interpretation-v1',
    interpretedAt: new Date().toISOString(),
    overallConfidence,
    acquisitionState,
    physicalTargetState,
    periodicMotionState,
    tissueInterpretationState: 'not-supported',
    medicalInterpretationState: 'not-validated',
    claims,
    blockedReasons,
    summary:
      acquisitionState === 'invalid'
        ? 'Mätningen är tekniskt underkänd och ska inte tolkas.'
        : periodicMotionState === 'supported'
          ? 'Mätningen stödjer ett stabilt reflektionsmål med periodisk mekanisk RF-rörelse.'
          : 'Mätningen innehåller RF-information men saknar tillräckligt stöd för stabil mekanisk periodicitet.',
  };
}
