import { describe, expect, it } from 'vitest';

import { scannerHardwareProfiles } from '@/services/scanner/hardwareProfiles';
import { createCircularTomographyGeometry } from '@/services/scanner/tomography/geometry';
import { SimulatedTomographyProvider } from '@/services/scanner/tomography/provider';
import { reconstructTomography } from '@/services/scanner/tomography/reconstruction';
import {
  createTomographyFrequencySweep,
  simulateTomographyCapture,
} from '@/services/scanner/tomography/simulator';
import { validateTomographyCapture } from '@/services/scanner/tomography/validation';

const grid = {
  width: 31,
  height: 31,
  originXMeters: -0.15,
  originYMeters: -0.15,
  spacingXMeters: 0.01,
  spacingYMeters: 0.01,
};

describe('multistatic microwave tomography research track', () => {
  it('keeps vital sensing and tomography as separate hardware tracks', () => {
    const vitalProfiles = scannerHardwareProfiles.filter(
      ({ track }) => track === 'vital-motion',
    );
    const tomographyProfiles = scannerHardwareProfiles.filter(
      ({ track }) => track === 'microwave-tomography',
    );

    expect(vitalProfiles.length).toBeGreaterThan(0);
    expect(tomographyProfiles).toHaveLength(1);
    expect(tomographyProfiles[0]?.role).toBe('multistatic-tomography');
    expect(tomographyProfiles[0]?.modality).toBe('microwave-tomography');
  });

  it('localizes a deterministic differential scatterer with coherent backprojection', () => {
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
    const target = { xMeters: 0.04, yMeters: -0.03, amplitude: 0.004 };
    const background = simulateTomographyCapture({
      id: 'tomography-background',
      geometry,
      calibrationRole: 'background',
      frequenciesHz,
      noiseAmplitude: 0,
    });
    const subject = simulateTomographyCapture({
      id: 'tomography-subject',
      geometry,
      calibrationRole: 'subject',
      frequenciesHz,
      noiseAmplitude: 0,
      scatterers: [target],
    });

    const reconstruction = reconstructTomography({ subject, background, grid });

    expect(reconstruction.status).toBe('available');
    expect(reconstruction.qualityGate.verdict).toBe(
      'approved-for-reconstruction',
    );
    expect(reconstruction.differentialMeasurementCount).toBeGreaterThan(1_000);
    expect(reconstruction.peak).toBeDefined();
    expect(
      Math.hypot(
        (reconstruction.peak?.xMeters ?? 0) - target.xMeters,
        (reconstruction.peak?.yMeters ?? 0) - target.yMeters,
      ),
    ).toBeLessThan(0.04);
    expect(reconstruction.peak?.normalizedContrast).toBeCloseTo(1, 6);
  });

  it('uses one provider contract for background and subject acquisition', async () => {
    const provider = new SimulatedTomographyProvider();
    const geometry = createCircularTomographyGeometry({ antennaCount: 12 });
    const sweep = createTomographyFrequencySweep({ frequencyCount: 16 });
    await provider.connect();
    await provider.configure({ geometry, sweep });
    const background = await provider.capture({
      id: 'provider-background',
      calibrationRole: 'background',
    });
    provider.setScatterers([
      { xMeters: 0.02, yMeters: 0.01, amplitude: 0.004 },
    ]);
    const subject = await provider.capture({
      id: 'provider-subject',
      calibrationRole: 'subject',
      referenceCaptureId: background.id,
    });
    await provider.disconnect();

    expect(validateTomographyCapture(background).valid).toBe(true);
    expect(validateTomographyCapture(subject).valid).toBe(true);
    expect(subject.referenceCaptureId).toBe(background.id);
    expect(subject.measurements).toHaveLength(background.measurements.length);
  });

  it('rejects malformed measurement sets before inverse reconstruction', () => {
    const geometry = createCircularTomographyGeometry({ antennaCount: 12 });
    const frequenciesHz = createTomographyFrequencySweep({ frequencyCount: 16 })
      .frequenciesHz;
    const background = simulateTomographyCapture({
      id: 'invalid-background',
      geometry,
      calibrationRole: 'background',
      frequenciesHz,
      noiseAmplitude: 0,
    });
    const subject = simulateTomographyCapture({
      id: 'invalid-subject',
      geometry,
      calibrationRole: 'subject',
      frequenciesHz,
      noiseAmplitude: 0,
      scatterers: [{ xMeters: 0, yMeters: 0, amplitude: 0.004 }],
    });
    subject.measurements.push({ ...subject.measurements[0]! });

    const validation = validateTomographyCapture(subject);
    const reconstruction = reconstructTomography({ subject, background, grid });

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('Duplicate'))).toBe(true);
    expect(reconstruction.status).toBe('incompatible-captures');
  });

  it('rejects insufficient geometry and never promotes contrast into medical claims', () => {
    const geometry = createCircularTomographyGeometry({ antennaCount: 8 });
    geometry.antennas.forEach((antenna, index) => {
      antenna.enabled = index < 4;
    });
    const frequenciesHz = [2_400_000_000, 2_450_000_000, 2_500_000_000];
    const background = simulateTomographyCapture({
      id: 'weak-background',
      geometry,
      calibrationRole: 'background',
      frequenciesHz,
      noiseAmplitude: 0,
    });
    const subject = simulateTomographyCapture({
      id: 'weak-subject',
      geometry,
      calibrationRole: 'subject',
      frequenciesHz,
      noiseAmplitude: 0,
      scatterers: [{ xMeters: 0, yMeters: 0, amplitude: 0.004 }],
    });

    const reconstruction = reconstructTomography({ subject, background, grid });

    expect(reconstruction.status).toBe('quality-rejected');
    expect(reconstruction.qualityGate.verdict).toBe('rejected');
    expect(
      reconstruction.claims.find(({ id }) => id === 'anatomy')?.state,
    ).toBe('not-validated');
    expect(
      reconstruction.claims.find(({ id }) => id === 'blood-flow')?.state,
    ).toBe('not-supported');
    expect(
      reconstruction.claims.find(({ id }) => id === 'stenosis')?.state,
    ).toBe('not-supported');
    expect(
      reconstruction.claims.find(({ id }) => id === 'ischemia-infarction')
        ?.state,
    ).toBe('not-validated');
  });
});
