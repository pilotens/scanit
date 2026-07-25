import { createCircularTomographyGeometry } from './geometry';
import { reconstructTomography } from './reconstruction';
import {
  createTomographyFrequencySweep,
  simulateTomographyCapture,
} from './simulator';

export function runTomographyBenchDiagnostic() {
  const geometry = createCircularTomographyGeometry({
    antennaCount: 12,
    radiusMeters: 0.27,
    fieldOfViewMeters: 0.3,
    geometryUncertaintyMillimeters: 1,
  });
  const frequenciesHz = createTomographyFrequencySweep({
    startFrequencyHz: 2_500_000_000,
    endFrequencyHz: 6_500_000_000,
    frequencyCount: 16,
  }).frequenciesHz;
  const expectedScatterer = {
    xMeters: 0.04,
    yMeters: -0.03,
    amplitude: 0.004,
  };
  const background = simulateTomographyCapture({
    id: 'bench-background',
    geometry,
    calibrationRole: 'background',
    frequenciesHz,
    noiseAmplitude: 0.00005,
  });
  const subject = simulateTomographyCapture({
    id: 'bench-subject',
    geometry,
    calibrationRole: 'subject',
    frequenciesHz,
    noiseAmplitude: 0.00005,
    scatterers: [expectedScatterer],
  });
  const reconstruction = reconstructTomography({
    subject,
    background,
    grid: {
      width: 31,
      height: 31,
      originXMeters: -0.15,
      originYMeters: -0.15,
      spacingXMeters: 0.01,
      spacingYMeters: 0.01,
    },
  });
  const localizationErrorMeters = reconstruction.peak
    ? Math.hypot(
        reconstruction.peak.xMeters - expectedScatterer.xMeters,
        reconstruction.peak.yMeters - expectedScatterer.yMeters,
      )
    : undefined;

  return {
    version: 'tomography-bench-diagnostic-v1' as const,
    expectedScatterer,
    reconstruction,
    localizationErrorMeters,
    passed:
      reconstruction.status === 'available' &&
      reconstruction.qualityGate.verdict === 'approved-for-reconstruction' &&
      localizationErrorMeters !== undefined &&
      localizationErrorMeters < 0.05,
  };
}
