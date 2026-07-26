import type {
  TomographyCalibration,
  TomographyCapture,
  TomographyDifferentialMeasurement,
} from '@/domain/tomography';

import {
  tomographyMagnitude,
  tomographySubtract,
} from './complex';
import { tomographyPairKey } from './geometry';

const mean = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;

export function capturesAreTomographicallyCompatible(
  subject: TomographyCapture,
  background: TomographyCapture,
) {
  if (subject.hardwareProfileId !== background.hardwareProfileId) return false;
  if (subject.geometry.id !== background.geometry.id) return false;
  if (subject.sweep.frequenciesHz.length !== background.sweep.frequenciesHz.length) {
    return false;
  }
  return subject.sweep.frequenciesHz.every(
    (frequency, index) =>
      Math.abs(frequency - (background.sweep.frequenciesHz[index] ?? NaN)) < 1,
  );
}

export function createTomographyBackgroundCalibration(
  background: TomographyCapture,
): TomographyCalibration {
  const uniquePaths = new Set(
    background.measurements.map(
      ({ txAntennaId, rxAntennaId }) => `${txAntennaId}|${rxAntennaId}`,
    ),
  );
  const phaseRepeatabilityRadians = mean(
    background.measurements.map(({ phaseUncertaintyRadians }) =>
      Math.max(0, phaseUncertaintyRadians),
    ),
  );
  const magnitudeRepeatabilityDb = mean(
    background.measurements.map(({ magnitudeUncertaintyDb }) =>
      Math.max(0, magnitudeUncertaintyDb),
    ),
  );
  const qualityFlags: string[] = [];
  if (background.calibrationRole !== 'background') {
    qualityFlags.push('capture-not-marked-as-background');
  }
  if (!background.sweep.coherent) qualityFlags.push('frequency-sweep-not-coherent');
  if (phaseRepeatabilityRadians > 0.12) qualityFlags.push('phase-repeatability-poor');
  if (magnitudeRepeatabilityDb > 0.5) qualityFlags.push('magnitude-repeatability-poor');

  return {
    version: 'tomography-background-calibration-v1',
    id: `tom-cal-${background.id}`,
    createdAt: background.createdAt,
    backgroundCaptureId: background.id,
    geometryId: background.geometry.id,
    hardwareProfileId: background.hardwareProfileId,
    pathCount: uniquePaths.size,
    frequencyCount: background.sweep.frequenciesHz.length,
    stable: qualityFlags.length === 0,
    phaseRepeatabilityRadians,
    magnitudeRepeatabilityDb,
    qualityFlags,
  };
}

export function createDifferentialTomographyMeasurements(
  subject: TomographyCapture,
  background: TomographyCapture,
): TomographyDifferentialMeasurement[] {
  if (!capturesAreTomographicallyCompatible(subject, background)) return [];
  const backgroundByKey = new Map(
    background.measurements.map((measurement) => [
      tomographyPairKey(
        measurement.txAntennaId,
        measurement.rxAntennaId,
        measurement.frequencyHz,
      ),
      measurement,
    ]),
  );

  return subject.measurements.flatMap((measurement) => {
    const backgroundMeasurement = backgroundByKey.get(
      tomographyPairKey(
        measurement.txAntennaId,
        measurement.rxAntennaId,
        measurement.frequencyHz,
      ),
    );
    if (!backgroundMeasurement) return [];
    const differentialS21 = tomographySubtract(
      measurement.s21,
      backgroundMeasurement.s21,
    );
    const combinedPhaseUncertainty =
      measurement.phaseUncertaintyRadians +
      backgroundMeasurement.phaseUncertaintyRadians;
    const combinedMagnitudeUncertainty =
      measurement.magnitudeUncertaintyDb +
      backgroundMeasurement.magnitudeUncertaintyDb;
    const signalMagnitude = tomographyMagnitude(differentialS21);
    const uncertaintyPenalty =
      1 + combinedPhaseUncertainty * 10 + combinedMagnitudeUncertainty;
    return [
      {
        txAntennaId: measurement.txAntennaId,
        rxAntennaId: measurement.rxAntennaId,
        frequencyHz: measurement.frequencyHz,
        differentialS21,
        weight:
          Math.min(1, signalMagnitude * 50) /
          Math.max(uncertaintyPenalty, 0.1),
      },
    ];
  });
}
