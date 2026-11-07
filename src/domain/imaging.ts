export type Modality = 'ultrasound' | 'microwave' | 'uwb' | 'mmwave' | 'imu' | 'camera';

export type Vec3 = { x: number; y: number; z: number };
export type Quaternion = { x: number; y: number; z: number; w: number };

export type SensorPose = {
  positionMm: Vec3;
  orientation: Quaternion;
  timestampMs: number;
};

export type MeasurementProvenance = 'measured' | 'inferred' | 'unknown';

export type UltrasoundFrame = {
  modality: 'ultrasound';
  pose: SensorPose;
  width: number;
  depth: number;
  axialSpacingMm: number;
  lateralSpacingMm: number;
  envelope: number[];
  isSimulated: boolean;
};

export type MicrowaveSample = {
  modality: 'microwave';
  pose: SensorPose;
  frequencyHz: number;
  tx: number;
  rx: number;
  real: number;
  imaginary: number;
  isSimulated: boolean;
};

export type MotionSample = {
  modality: 'uwb' | 'mmwave';
  pose: SensorPose;
  rangeMm: number;
  displacementMm: number;
  confidence: number;
  isSimulated: boolean;
};

export type ImagingMeasurement = UltrasoundFrame | MicrowaveSample | MotionSample;

export type Voxel = {
  positionMm: Vec3;
  structuralIntensity: number | null;
  dielectricContrast: number | null;
  motionAmplitude: number | null;
  confidence: number;
  provenance: MeasurementProvenance;
  modalities: Modality[];
};

export type ReconstructionVolume = {
  id: string;
  createdAt: string;
  voxelSizeMm: number;
  dimensions: { x: number; y: number; z: number };
  voxels: Voxel[];
  isSimulated: boolean;
  algorithm: string;
};

export type ReconstructionInput = {
  measurements: ImagingMeasurement[];
  voxelSizeMm?: number;
};
