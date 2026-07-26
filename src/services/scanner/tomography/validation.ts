import type { TomographyCapture } from '@/domain/tomography';

import { tomographyPairKey } from './geometry';

export type TomographyCaptureValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  uniqueMeasurementCount: number;
  expectedMeasurementCount: number;
};

export function validateTomographyCapture(
  capture: TomographyCapture,
): TomographyCaptureValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const activeAntennas = capture.geometry.antennas.filter(({ enabled }) => enabled);
  const antennaIds = new Set(capture.geometry.antennas.map(({ id }) => id));
  const frequencies = capture.sweep.frequenciesHz;
  const frequencySet = new Set(frequencies.map((frequency) => Math.round(frequency)));
  const measurementKeys = new Set<string>();

  if (capture.schemaVersion !== 1) errors.push('Unsupported tomography capture schema.');
  if (activeAntennas.length < 2) errors.push('At least two active antennas are required.');
  if (!frequencies.length) errors.push('The tomography sweep contains no frequencies.');
  if (!capture.sweep.coherent) warnings.push('The frequency sweep is not marked coherent.');
  if (capture.geometry.fieldOfView.widthMeters <= 0 || capture.geometry.fieldOfView.heightMeters <= 0) {
    errors.push('The field of view must have positive dimensions.');
  }

  for (const measurement of capture.measurements) {
    if (!antennaIds.has(measurement.txAntennaId)) {
      errors.push(`Unknown TX antenna ${measurement.txAntennaId}.`);
    }
    if (!antennaIds.has(measurement.rxAntennaId)) {
      errors.push(`Unknown RX antenna ${measurement.rxAntennaId}.`);
    }
    if (measurement.txAntennaId === measurement.rxAntennaId) {
      errors.push(`Self-path ${measurement.txAntennaId} is not supported in v1.`);
    }
    if (!frequencySet.has(Math.round(measurement.frequencyHz))) {
      errors.push(`Measurement frequency ${measurement.frequencyHz} is outside the declared sweep.`);
    }
    if (!Number.isFinite(measurement.s21.real) || !Number.isFinite(measurement.s21.imaginary)) {
      errors.push('A tomography measurement contains non-finite complex data.');
    }
    if (measurement.phaseUncertaintyRadians < 0 || measurement.magnitudeUncertaintyDb < 0) {
      errors.push('Measurement uncertainties must be non-negative.');
    }
    const key = tomographyPairKey(
      measurement.txAntennaId,
      measurement.rxAntennaId,
      measurement.frequencyHz,
    );
    if (measurementKeys.has(key)) errors.push(`Duplicate measurement ${key}.`);
    measurementKeys.add(key);
  }

  const expectedMeasurementCount =
    activeAntennas.length *
    Math.max(0, activeAntennas.length - 1) *
    frequencies.length;
  if (measurementKeys.size < expectedMeasurementCount) {
    warnings.push(
      `Capture contains ${measurementKeys.size}/${expectedMeasurementCount} expected directed path-frequency measurements.`,
    );
  }
  if (capture.sweep.startFrequencyHz !== Math.min(...frequencies)) {
    warnings.push('Declared start frequency does not match the sweep array.');
  }
  if (capture.sweep.endFrequencyHz !== Math.max(...frequencies)) {
    warnings.push('Declared end frequency does not match the sweep array.');
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    uniqueMeasurementCount: measurementKeys.size,
    expectedMeasurementCount,
  };
}
