import type {
  TomographyCapture,
  TomographyComplex,
  TomographyGeometry,
  TomographyPoint2D,
} from '@/domain/tomography';

import {
  tomographyAdd,
  tomographyExponential,
  tomographyScale,
} from './complex';
import {
  activeTomographyAntennas,
  tomographyDistance,
} from './geometry';

const SPEED_OF_LIGHT_METERS_PER_SECOND = 299_792_458;

export type TomographySimulatedScatterer = TomographyPoint2D & {
  amplitude: number;
  phaseRadians?: number;
};

export const createTomographyFrequencySweep = (input?: {
  startFrequencyHz?: number;
  endFrequencyHz?: number;
  frequencyCount?: number;
}) => {
  const startFrequencyHz = input?.startFrequencyHz ?? 2_500_000_000;
  const endFrequencyHz = input?.endFrequencyHz ?? 6_500_000_000;
  const frequencyCount = Math.max(2, Math.round(input?.frequencyCount ?? 24));
  const frequenciesHz = Array.from({ length: frequencyCount }, (_, index) =>
    startFrequencyHz +
    ((endFrequencyHz - startFrequencyHz) * index) /
      Math.max(1, frequencyCount - 1),
  );
  return {
    startFrequencyHz,
    endFrequencyHz,
    frequenciesHz,
    coherent: true as const,
    sourcePowerDbm: -10,
    intermediateFrequencyBandwidthHz: 10_000,
  };
};

const deterministicNoise = (seed: number) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value) - 0.5;
};

const propagation = (
  frequencyHz: number,
  pathLengthMeters: number,
): TomographyComplex => {
  const wavenumber =
    (2 * Math.PI * frequencyHz) / SPEED_OF_LIGHT_METERS_PER_SECOND;
  return tomographyScale(
    tomographyExponential(-wavenumber * pathLengthMeters),
    1 / Math.max(pathLengthMeters, 0.03),
  );
};

export function simulateTomographyCapture(input: {
  id: string;
  geometry: TomographyGeometry;
  scatterers?: TomographySimulatedScatterer[];
  calibrationRole: TomographyCapture['calibrationRole'];
  frequenciesHz?: number[];
  noiseAmplitude?: number;
  temperatureCelsius?: number;
}): TomographyCapture {
  const antennas = activeTomographyAntennas(input.geometry);
  const frequenciesHz =
    input.frequenciesHz ?? createTomographyFrequencySweep().frequenciesHz;
  const sweep = {
    startFrequencyHz: Math.min(...frequenciesHz),
    endFrequencyHz: Math.max(...frequenciesHz),
    frequenciesHz,
    coherent: true,
    sourcePowerDbm: -10,
    intermediateFrequencyBandwidthHz: 10_000,
  };
  const scatterers = input.scatterers ?? [];
  const noiseAmplitude = input.noiseAmplitude ?? 0.00015;
  let measurementIndex = 0;
  const timestampStart = 2_100_000_000_000_000_000n;

  const measurements = antennas.flatMap((tx) =>
    antennas.flatMap((rx) => {
      if (tx.id === rx.id) return [];
      return frequenciesHz.map((frequencyHz) => {
        const directDistance = tomographyDistance(tx, rx);
        const direct = tomographyScale(
          propagation(frequencyHz, directDistance),
          0.035,
        );
        let s21 = direct;

        for (const scatterer of scatterers) {
          const pathLength =
            tomographyDistance(tx, scatterer) +
            tomographyDistance(scatterer, rx);
          const scattererResponse = tomographyScale(
            propagation(frequencyHz, pathLength),
            scatterer.amplitude /
              Math.sqrt(
                Math.max(
                  tomographyDistance(tx, scatterer) *
                    tomographyDistance(scatterer, rx),
                  0.001,
                ),
              ),
          );
          s21 = tomographyAdd(
            s21,
            scatterer.phaseRadians
              ? {
                  real:
                    scattererResponse.real * Math.cos(scatterer.phaseRadians) -
                    scattererResponse.imaginary * Math.sin(scatterer.phaseRadians),
                  imaginary:
                    scattererResponse.real * Math.sin(scatterer.phaseRadians) +
                    scattererResponse.imaginary * Math.cos(scatterer.phaseRadians),
                }
              : scattererResponse,
          );
        }

        const noiseSeed =
          measurementIndex * 17 + tx.index * 101 + rx.index * 1009;
        s21 = {
          real: s21.real + deterministicNoise(noiseSeed) * noiseAmplitude,
          imaginary:
            s21.imaginary +
            deterministicNoise(noiseSeed + 1) * noiseAmplitude,
        };
        const timestampNs = String(
          timestampStart + BigInt(measurementIndex) * 1_000_000n,
        );
        measurementIndex += 1;
        return {
          txAntennaId: tx.id,
          rxAntennaId: rx.id,
          frequencyHz,
          s21,
          magnitudeUncertaintyDb: 0.03,
          phaseUncertaintyRadians: 0.01,
          timestampNs,
        };
      });
    }),
  );

  return {
    schemaVersion: 1,
    id: input.id,
    createdAt: new Date(0).toISOString(),
    hardwareProfileId: 'multistatic-wifi-band-tomography-array',
    geometry: input.geometry,
    sweep,
    measurements,
    calibrationRole: input.calibrationRole,
    temperatureCelsius: input.temperatureCelsius ?? 23,
    notes: [
      'Deterministisk elektromagnetisk framåtmodell för algoritmtest.',
      'Simulerade kontraster är inte anatomiska eller medicinska fynd.',
    ],
    isSimulated: true,
  };
}
