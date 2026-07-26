import type {
  TomographyCapture,
  TomographyGrid,
  TomographyReconstruction,
} from '@/domain/tomography';

import {
  tomographyAdd,
  tomographyExponential,
  tomographyMagnitude,
  tomographyMultiply,
  tomographyScale,
} from './complex';
import {
  capturesAreTomographicallyCompatible,
  createDifferentialTomographyMeasurements,
  createTomographyBackgroundCalibration,
} from './calibration';
import { tomographyDistance } from './geometry';
import {
  evaluateTomographyQuality,
  tomographyApertureCoverageDegrees,
} from './quality';
import { validateTomographyCapture } from './validation';

const SPEED_OF_LIGHT_METERS_PER_SECOND = 299_792_458;

const defaultGrid = (subject: TomographyCapture): TomographyGrid => {
  const width = 41;
  const height = 41;
  const field = subject.geometry.fieldOfView;
  return {
    width,
    height,
    originXMeters: field.center.xMeters - field.widthMeters / 2,
    originYMeters: field.center.yMeters - field.heightMeters / 2,
    spacingXMeters: field.widthMeters / Math.max(1, width - 1),
    spacingYMeters: field.heightMeters / Math.max(1, height - 1),
  };
};

const claims = (): TomographyReconstruction['claims'] => [
  {
    id: 'relative-scattering-contrast',
    state: 'supported-as-engineering-signal',
    explanation:
      'Kartan visar koherent differential spridningskontrast relativt en matchande bakgrundsmätning.',
  },
  {
    id: 'anatomy',
    state: 'not-validated',
    explanation:
      'Kontrastkartan är inte registrerad eller validerad mot CT, MRI eller ultraljud.',
  },
  {
    id: 'blood-flow',
    state: 'not-supported',
    explanation:
      'Den statiska S21-rekonstruktionen mäter inte riktat eller kvantifierat blodflöde.',
  },
  {
    id: 'coronary-artery',
    state: 'not-supported',
    explanation:
      'Den nuvarande upplösningen och inversmodellen kan inte identifiera kranskärl.',
  },
  {
    id: 'stenosis',
    state: 'not-supported',
    explanation:
      'En förträngning kan inte härledas utan validerad kärlavbildning och klinisk referens.',
  },
  {
    id: 'ischemia-infarction',
    state: 'not-validated',
    explanation:
      'Ingen koppling mellan rekonstruktionskontrast och ischemi eller hjärtinfarkt är kliniskt validerad.',
  },
];

export function reconstructTomography(input: {
  subject: TomographyCapture;
  background: TomographyCapture;
  grid?: TomographyGrid;
}): TomographyReconstruction {
  const { subject, background } = input;
  const subjectValidation = validateTomographyCapture(subject);
  const backgroundValidation = validateTomographyCapture(background);
  const compatible =
    subjectValidation.valid &&
    backgroundValidation.valid &&
    capturesAreTomographicallyCompatible(subject, background);
  const calibration = createTomographyBackgroundCalibration(background);
  const differentialMeasurements = compatible
    ? createDifferentialTomographyMeasurements(subject, background)
    : [];
  const qualityGate = evaluateTomographyQuality({
    subject,
    background,
    calibration,
    differentialMeasurements,
    compatible,
  });
  const grid = input.grid ?? defaultGrid(subject);
  const bandwidthHz =
    subject.sweep.endFrequencyHz - subject.sweep.startFrequencyHz;
  const estimatedRangeResolutionMeters =
    bandwidthHz > 0
      ? SPEED_OF_LIGHT_METERS_PER_SECOND / (2 * bandwidthHz)
      : Infinity;
  const warnings: string[] = [
    'Första ordningens backprojection ignorerar stark multipath och full icke-linjär vävnadsspridning.',
    'Kartan måste jämföras med phantom och oberoende medicinsk bildreferens innan anatomiska slutsatser prövas.',
    ...subjectValidation.warnings.map((warning) => `Subjekt: ${warning}`),
    ...backgroundValidation.warnings.map((warning) => `Bakgrund: ${warning}`),
    ...subjectValidation.errors.map((error) => `Subjektfel: ${error}`),
    ...backgroundValidation.errors.map((error) => `Bakgrundsfel: ${error}`),
  ];

  if (!compatible) {
    return {
      version: 'tomography-coherent-backprojection-v1',
      status: 'incompatible-captures',
      subjectCaptureId: subject.id,
      backgroundCaptureId: background.id,
      grid,
      normalizedContrast: Array.from(
        { length: grid.width * grid.height },
        () => 0,
      ),
      estimatedRangeResolutionMeters,
      apertureCoverageDegrees: tomographyApertureCoverageDegrees(subject),
      qualityGate,
      differentialMeasurementCount: 0,
      claims: claims(),
      warnings: [...new Set(warnings)],
    };
  }

  if (qualityGate.verdict === 'rejected') {
    return {
      version: 'tomography-coherent-backprojection-v1',
      status: 'quality-rejected',
      subjectCaptureId: subject.id,
      backgroundCaptureId: background.id,
      grid,
      normalizedContrast: Array.from(
        { length: grid.width * grid.height },
        () => 0,
      ),
      estimatedRangeResolutionMeters,
      apertureCoverageDegrees: tomographyApertureCoverageDegrees(subject),
      qualityGate,
      differentialMeasurementCount: differentialMeasurements.length,
      claims: claims(),
      warnings: [...new Set(warnings)],
    };
  }

  const antennas = new Map(
    subject.geometry.antennas.map((antenna) => [antenna.id, antenna]),
  );
  const contrast = Array.from(
    { length: grid.width * grid.height },
    (_, pixelIndex) => {
      const pixelX = pixelIndex % grid.width;
      const pixelY = Math.floor(pixelIndex / grid.width);
      const point = {
        xMeters: grid.originXMeters + pixelX * grid.spacingXMeters,
        yMeters: grid.originYMeters + pixelY * grid.spacingYMeters,
      };
      let coherentSum = { real: 0, imaginary: 0 };
      let totalWeight = 0;

      for (const measurement of differentialMeasurements) {
        const tx = antennas.get(measurement.txAntennaId);
        const rx = antennas.get(measurement.rxAntennaId);
        if (!tx || !rx || measurement.weight <= 0) continue;
        const pathLength =
          tomographyDistance(tx, point) + tomographyDistance(point, rx);
        const wavenumber =
          (2 * Math.PI * measurement.frequencyHz) /
          SPEED_OF_LIGHT_METERS_PER_SECOND;
        const focusingKernel = tomographyExponential(wavenumber * pathLength);
        const focused = tomographyMultiply(
          measurement.differentialS21,
          focusingKernel,
        );
        coherentSum = tomographyAdd(
          coherentSum,
          tomographyScale(focused, measurement.weight),
        );
        totalWeight += measurement.weight;
      }

      return totalWeight > 0
        ? tomographyMagnitude(tomographyScale(coherentSum, 1 / totalWeight))
        : 0;
    },
  );
  const maximum = Math.max(...contrast, Number.EPSILON);
  const normalizedContrast = contrast.map((value) => value / maximum);
  let peakIndex = 0;
  for (let index = 1; index < normalizedContrast.length; index += 1) {
    if ((normalizedContrast[index] ?? 0) > (normalizedContrast[peakIndex] ?? 0)) {
      peakIndex = index;
    }
  }
  const peakPixelX = peakIndex % grid.width;
  const peakPixelY = Math.floor(peakIndex / grid.width);

  if (qualityGate.verdict === 'repeat') {
    warnings.push('Rekonstruktionen skapades men kvalitetssystemet rekommenderar en ny mätning.');
  }

  return {
    version: 'tomography-coherent-backprojection-v1',
    status: 'available',
    subjectCaptureId: subject.id,
    backgroundCaptureId: background.id,
    grid,
    normalizedContrast,
    peak: {
      xMeters: grid.originXMeters + peakPixelX * grid.spacingXMeters,
      yMeters: grid.originYMeters + peakPixelY * grid.spacingYMeters,
      normalizedContrast: normalizedContrast[peakIndex] ?? 0,
      pixelX: peakPixelX,
      pixelY: peakPixelY,
    },
    estimatedRangeResolutionMeters,
    apertureCoverageDegrees: tomographyApertureCoverageDegrees(subject),
    qualityGate,
    differentialMeasurementCount: differentialMeasurements.length,
    claims: claims(),
    warnings: [...new Set(warnings)],
  };
}
