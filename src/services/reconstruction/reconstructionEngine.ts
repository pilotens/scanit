import type {
  ImagingMeasurement,
  ReconstructionInput,
  ReconstructionVolume,
  Vec3,
  Voxel,
} from '@/domain/imaging';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const key = (p: Vec3, size: number) =>
  [Math.round(p.x / size), Math.round(p.y / size), Math.round(p.z / size)].join(':');

type Accumulator = {
  positionMm: Vec3;
  structural: number[];
  dielectric: number[];
  motion: number[];
  modalities: Set<'ultrasound' | 'microwave' | 'uwb' | 'mmwave'>;
};

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/**
 * Deterministic baseline reconstructor.
 *
 * This is deliberately not a medical AI model. It projects sensor evidence into
 * a common voxel grid so future reconstruction algorithms can be evaluated
 * against a transparent baseline.
 */
export const reconstructVolume = (input: ReconstructionInput): ReconstructionVolume => {
  const voxelSizeMm = input.voxelSizeMm ?? 5;
  const grid = new Map<string, Accumulator>();

  const getCell = (positionMm: Vec3): Accumulator => {
    const id = key(positionMm, voxelSizeMm);
    const existing = grid.get(id);
    if (existing) return existing;
    const cell: Accumulator = {
      positionMm: {
        x: Math.round(positionMm.x / voxelSizeMm) * voxelSizeMm,
        y: Math.round(positionMm.y / voxelSizeMm) * voxelSizeMm,
        z: Math.round(positionMm.z / voxelSizeMm) * voxelSizeMm,
      },
      structural: [],
      dielectric: [],
      motion: [],
      modalities: new Set(),
    };
    grid.set(id, cell);
    return cell;
  };

  for (const measurement of input.measurements) {
    if (measurement.modality === 'ultrasound') {
      const samples = Math.min(measurement.envelope.length, measurement.depth);
      for (let z = 0; z < samples; z += 1) {
        const cell = getCell({
          x: measurement.pose.positionMm.x,
          y: measurement.pose.positionMm.y,
          z: measurement.pose.positionMm.z + z * measurement.axialSpacingMm,
        });
        cell.structural.push(clamp01(measurement.envelope[z] ?? 0));
        cell.modalities.add('ultrasound');
      }
      continue;
    }

    if (measurement.modality === 'microwave') {
      const magnitude = Math.hypot(measurement.real, measurement.imaginary);
      const cell = getCell(measurement.pose.positionMm);
      cell.dielectric.push(clamp01(magnitude));
      cell.modalities.add('microwave');
      continue;
    }

    const cell = getCell({
      ...measurement.pose.positionMm,
      z: measurement.pose.positionMm.z + measurement.rangeMm,
    });
    cell.motion.push(Math.abs(measurement.displacementMm));
    cell.modalities.add(measurement.modality);
  }

  const voxels: Voxel[] = [...grid.values()].map((cell) => {
    const evidenceChannels =
      Number(cell.structural.length > 0) +
      Number(cell.dielectric.length > 0) +
      Number(cell.motion.length > 0);

    return {
      positionMm: cell.positionMm,
      structuralIntensity: mean(cell.structural),
      dielectricContrast: mean(cell.dielectric),
      motionAmplitude: mean(cell.motion),
      confidence: clamp01(0.25 + evidenceChannels * 0.22),
      provenance: 'measured',
      modalities: [...cell.modalities],
    };
  });

  const axes = (axis: keyof Vec3) => voxels.map((voxel) => voxel.positionMm[axis]);
  const span = (values: number[]) =>
    values.length ? Math.round((Math.max(...values) - Math.min(...values)) / voxelSizeMm) + 1 : 0;

  return {
    id: `volume-${Date.now()}`,
    createdAt: new Date().toISOString(),
    voxelSizeMm,
    dimensions: { x: span(axes('x')), y: span(axes('y')), z: span(axes('z')) },
    voxels,
    isSimulated: input.measurements.every((measurement) => measurement.isSimulated),
    algorithm: 'evidence-grid-v0',
  };
};
