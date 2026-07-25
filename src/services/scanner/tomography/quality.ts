import type {
  TomographyCalibration,
  TomographyCapture,
  TomographyDifferentialMeasurement,
  TomographyQualityGate,
} from '@/domain/tomography';

import { activeTomographyAntennas } from './geometry';

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, value));

const circularCoverageDegrees = (angles: number[]) => {
  if (angles.length < 2) return 0;
  const sorted = angles
    .map((angle) => {
      const wrapped = angle % (2 * Math.PI);
      return wrapped < 0 ? wrapped + 2 * Math.PI : wrapped;
    })
    .sort((left, right) => left - right);
  let largestGap = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    const next =
      index === sorted.length - 1
        ? sorted[0]! + 2 * Math.PI
        : sorted[index + 1]!;
    largestGap = Math.max(largestGap, next - current);
  }
  return ((2 * Math.PI - largestGap) * 180) / Math.PI;
};

export function evaluateTomographyQuality(input: {
  subject: TomographyCapture;
  background: TomographyCapture;
  calibration: TomographyCalibration;
  differentialMeasurements: TomographyDifferentialMeasurement[];
  compatible: boolean;
}): TomographyQualityGate {
  const {
    subject,
    background,
    calibration,
    differentialMeasurements,
    compatible,
  } = input;
  const activeAntennas = activeTomographyAntennas(subject.geometry);
  const coverageDegrees = circularCoverageDegrees(
    activeAntennas.map(({ azimuthRadians }) => azimuthRadians),
  );
  const frequencyCount = subject.sweep.frequenciesHz.length;
  const bandwidthHz =
    subject.sweep.endFrequencyHz - subject.sweep.startFrequencyHz;
  const uniquePaths = new Set(
    differentialMeasurements.map(
      ({ txAntennaId, rxAntennaId }) => `${txAntennaId}|${rxAntennaId}`,
    ),
  ).size;
  const expectedMeasurements = subject.measurements.length;
  const differentialCoverage =
    expectedMeasurements > 0
      ? differentialMeasurements.length / expectedMeasurements
      : 0;
  const averagePhaseUncertainty = subject.measurements.length
    ? subject.measurements.reduce(
        (sum, measurement) => sum + measurement.phaseUncertaintyRadians,
        0,
      ) / subject.measurements.length
    : Infinity;
  const temperatureDifference =
    subject.temperatureCelsius !== undefined &&
    background.temperatureCelsius !== undefined
      ? Math.abs(subject.temperatureCelsius - background.temperatureCelsius)
      : undefined;

  const metrics: TomographyQualityGate['metrics'] = [
    {
      id: 'capture-compatibility',
      label: 'Kompatibla mätningar',
      value: compatible ? 1 : 0,
      passed: compatible,
      blocking: !compatible,
      detail: compatible
        ? 'Geometri, hårdvara och frekvenssvep överensstämmer.'
        : 'Bakgrund och subjekt använder olika geometri, hårdvara eller frekvenser.',
    },
    {
      id: 'background-calibration',
      label: 'Bakgrundskalibrering',
      value: calibration.stable ? 1 : 0,
      passed: calibration.stable,
      blocking: !calibration.stable,
      detail: calibration.stable
        ? 'Bakgrundskalibreringen är stabil.'
        : calibration.qualityFlags.join(', ') || 'Kalibreringen är instabil.',
    },
    {
      id: 'antenna-count',
      label: 'Aktiva antenner',
      value: activeAntennas.length,
      unit: 'antenner',
      passed: activeAntennas.length >= 12,
      blocking: activeAntennas.length < 8,
      detail: `${activeAntennas.length} aktiva antennpositioner.`,
    },
    {
      id: 'angular-coverage',
      label: 'Vinkeltäckning',
      value: coverageDegrees,
      unit: 'grader',
      passed: coverageDegrees >= 300,
      blocking: coverageDegrees < 220,
      detail: `${coverageDegrees.toFixed(1)}° sammanhängande aperturtäckning.`,
    },
    {
      id: 'frequency-count',
      label: 'Frekvenspunkter',
      value: frequencyCount,
      unit: 'punkter',
      passed: frequencyCount >= 16,
      blocking: frequencyCount < 8,
      detail: `${frequencyCount} koherenta frekvenspunkter.`,
    },
    {
      id: 'bandwidth',
      label: 'Koherent bandbredd',
      value: bandwidthHz / 1_000_000_000,
      unit: 'GHz',
      passed: bandwidthHz >= 2_000_000_000,
      blocking: bandwidthHz < 500_000_000,
      detail: `${(bandwidthHz / 1_000_000_000).toFixed(2)} GHz svepbandbredd.`,
    },
    {
      id: 'multistatic-paths',
      label: 'Multistatiska vägar',
      value: uniquePaths,
      unit: 'TX/RX-par',
      passed: uniquePaths >= 100,
      blocking: uniquePaths < 40,
      detail: `${uniquePaths} unika sändar-/mottagarpar.`,
    },
    {
      id: 'differential-coverage',
      label: 'Bakgrundstäckning',
      value: differentialCoverage * 100,
      unit: '%',
      passed: differentialCoverage >= 0.98,
      blocking: differentialCoverage < 0.9,
      detail: `${(differentialCoverage * 100).toFixed(1)}% av subjektmätningen har matchande bakgrund.`,
    },
    {
      id: 'phase-uncertainty',
      label: 'Fasosäkerhet',
      value: averagePhaseUncertainty,
      unit: 'rad',
      passed: averagePhaseUncertainty <= 0.08,
      blocking: averagePhaseUncertainty > 0.25,
      detail: `${averagePhaseUncertainty.toFixed(3)} rad genomsnittlig fasosäkerhet.`,
    },
    {
      id: 'geometry-uncertainty',
      label: 'Geometriosäkerhet',
      value: subject.geometry.geometryUncertaintyMillimeters,
      unit: 'mm',
      passed: subject.geometry.geometryUncertaintyMillimeters <= 2,
      blocking: subject.geometry.geometryUncertaintyMillimeters > 8,
      detail: `±${subject.geometry.geometryUncertaintyMillimeters.toFixed(1)} mm positioneringsosäkerhet.`,
    },
    {
      id: 'temperature-match',
      label: 'Temperaturmatchning',
      value: temperatureDifference ?? 0,
      unit: '°C',
      passed: temperatureDifference === undefined || temperatureDifference <= 2,
      blocking: temperatureDifference !== undefined && temperatureDifference > 6,
      detail:
        temperatureDifference === undefined
          ? 'Temperatur saknas för en eller båda mätningarna.'
          : `${temperatureDifference.toFixed(1)} °C skillnad mellan bakgrund och subjekt.`,
    },
  ];

  const blocking = metrics.filter((metric) => metric.blocking);
  const failed = metrics.filter((metric) => !metric.passed);
  const score = Math.round(
    100 *
      (
        (compatible ? 1 : 0) * 0.16 +
        (calibration.stable ? 1 : 0) * 0.14 +
        clamp(activeAntennas.length / 16) * 0.1 +
        clamp(coverageDegrees / 330) * 0.1 +
        clamp(frequencyCount / 24) * 0.08 +
        clamp(bandwidthHz / 4_000_000_000) * 0.1 +
        clamp(uniquePaths / 160) * 0.1 +
        clamp(differentialCoverage) * 0.1 +
        clamp(1 - averagePhaseUncertainty / 0.25) * 0.06 +
        clamp(1 - subject.geometry.geometryUncertaintyMillimeters / 8) * 0.04 +
        clamp(1 - (temperatureDifference ?? 0) / 6) * 0.02
      ),
  );

  let verdict: TomographyQualityGate['verdict'];
  if (blocking.length || score < 45) verdict = 'rejected';
  else if (failed.length || score < 78) verdict = 'repeat';
  else verdict = 'approved-for-reconstruction';

  return {
    version: 'tomography-quality-v1',
    verdict,
    score,
    metrics,
    reasons: failed.map(({ label, detail }) => `${label}: ${detail}`),
  };
}

export function tomographyApertureCoverageDegrees(capture: TomographyCapture) {
  return circularCoverageDegrees(
    activeTomographyAntennas(capture.geometry).map(
      ({ azimuthRadians }) => azimuthRadians,
    ),
  );
}
