import type {
  ImagingMeasurement,
  MicrowaveSample,
  SensorPose,
  UltrasoundFrame,
} from '@/domain/imaging';

const identityPose = (x: number, timestampMs: number): SensorPose => ({
  positionMm: { x, y: 0, z: 0 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
  timestampMs,
});

export const createSimulatedChestSweep = (): ImagingMeasurement[] => {
  const measurements: ImagingMeasurement[] = [];
  const started = Date.now();

  for (let pass = 0; pass < 7; pass += 1) {
    const x = -45 + pass * 15;
    const pose = identityPose(x, started + pass * 40);

    const ultrasound: UltrasoundFrame = {
      modality: 'ultrasound',
      pose,
      width: 1,
      depth: 80,
      axialSpacingMm: 2,
      lateralSpacingMm: 2,
      envelope: Array.from({ length: 80 }, (_, index) => {
        const depthMm = index * 2;
        const superficial = Math.exp(-Math.pow(depthMm - 18, 2) / 90);
        const deepBoundary = Math.exp(-Math.pow(depthMm - 92, 2) / 260);
        return Math.min(1, 0.08 + superficial * 0.55 + deepBoundary * 0.72);
      }),
      isSimulated: true,
    };
    measurements.push(ultrasound);

    for (let frequencyIndex = 0; frequencyIndex < 8; frequencyIndex += 1) {
      const phase = frequencyIndex * 0.31 + pass * 0.09;
      const microwave: MicrowaveSample = {
        modality: 'microwave',
        pose: { ...pose, positionMm: { x, y: 0, z: 55 } },
        frequencyHz: 800_000_000 + frequencyIndex * 150_000_000,
        tx: pass % 4,
        rx: (pass + 1) % 4,
        real: 0.35 * Math.cos(phase),
        imaginary: 0.35 * Math.sin(phase),
        isSimulated: true,
      };
      measurements.push(microwave);
    }

    measurements.push({
      modality: 'uwb',
      pose,
      rangeMm: 85,
      displacementMm: 0.6 + 0.15 * Math.sin(pass),
      confidence: 0.8,
      isSimulated: true,
    });
  }

  return measurements;
};
