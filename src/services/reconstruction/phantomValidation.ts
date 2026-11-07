import type { ReconstructionVolume, Vec3 } from '@/domain/imaging';

export type PhantomTarget = {
  centerMm: Vec3;
  radiusMm: number;
};

export type PhantomMetrics = {
  nearestEvidenceErrorMm: number;
  evidenceWithinTarget: number;
  meanConfidenceWithinTarget: number;
  passed: boolean;
};

const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export const validatePhantomTarget = (
  volume: ReconstructionVolume,
  target: PhantomTarget,
  toleranceMm = 15,
): PhantomMetrics => {
  const distances = volume.voxels.map((voxel) => ({
    voxel,
    distance: distance(voxel.positionMm, target.centerMm),
  }));
  const nearestEvidenceErrorMm = distances.length
    ? Math.min(...distances.map((item) => item.distance))
    : Number.POSITIVE_INFINITY;
  const inside = distances.filter((item) => item.distance <= target.radiusMm);
  const meanConfidenceWithinTarget = inside.length
    ? inside.reduce((sum, item) => sum + item.voxel.confidence, 0) / inside.length
    : 0;

  return {
    nearestEvidenceErrorMm,
    evidenceWithinTarget: inside.length,
    meanConfidenceWithinTarget,
    passed: nearestEvidenceErrorMm <= toleranceMm && inside.length > 0,
  };
};
