export type TomographyComplex = {
  real: number;
  imaginary: number;
};

export type TomographyPoint2D = {
  xMeters: number;
  yMeters: number;
};

export type TomographyAntenna = TomographyPoint2D & {
  id: string;
  index: number;
  azimuthRadians: number;
  enabled: boolean;
};

export type TomographyGeometry = {
  schemaVersion: 1;
  id: string;
  coordinateSystem: 'scanner-local-cartesian';
  antennas: TomographyAntenna[];
  fieldOfView: {
    center: TomographyPoint2D;
    widthMeters: number;
    heightMeters: number;
  };
  nominalArrayRadiusMeters: number;
  geometryUncertaintyMillimeters: number;
};

export type TomographyFrequencySweep = {
  startFrequencyHz: number;
  endFrequencyHz: number;
  frequenciesHz: number[];
  coherent: boolean;
  sourcePowerDbm?: number;
  intermediateFrequencyBandwidthHz?: number;
};

export type TomographyPathMeasurement = {
  txAntennaId: string;
  rxAntennaId: string;
  frequencyHz: number;
  s21: TomographyComplex;
  magnitudeUncertaintyDb: number;
  phaseUncertaintyRadians: number;
  timestampNs: string;
};

export type TomographyCapture = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  hardwareProfileId: string;
  geometry: TomographyGeometry;
  sweep: TomographyFrequencySweep;
  measurements: TomographyPathMeasurement[];
  calibrationRole: 'background' | 'subject' | 'phantom-reference';
  referenceCaptureId?: string;
  temperatureCelsius?: number;
  notes: string[];
  isSimulated: boolean;
};

export type TomographyCalibration = {
  version: 'tomography-background-calibration-v1';
  id: string;
  createdAt: string;
  backgroundCaptureId: string;
  geometryId: string;
  hardwareProfileId: string;
  pathCount: number;
  frequencyCount: number;
  stable: boolean;
  phaseRepeatabilityRadians: number;
  magnitudeRepeatabilityDb: number;
  qualityFlags: string[];
};

export type TomographyDifferentialMeasurement = {
  txAntennaId: string;
  rxAntennaId: string;
  frequencyHz: number;
  differentialS21: TomographyComplex;
  weight: number;
};

export type TomographyQualityMetric = {
  id: string;
  label: string;
  value: number;
  unit?: string;
  passed: boolean;
  blocking: boolean;
  detail: string;
};

export type TomographyQualityGate = {
  version: 'tomography-quality-v1';
  verdict: 'approved-for-reconstruction' | 'repeat' | 'rejected';
  score: number;
  metrics: TomographyQualityMetric[];
  reasons: string[];
};

export type TomographyGrid = {
  width: number;
  height: number;
  originXMeters: number;
  originYMeters: number;
  spacingXMeters: number;
  spacingYMeters: number;
};

export type TomographyPeak = TomographyPoint2D & {
  normalizedContrast: number;
  pixelX: number;
  pixelY: number;
};

export type TomographyClaim = {
  id: 'relative-scattering-contrast' | 'anatomy' | 'blood-flow' | 'coronary-artery' | 'stenosis' | 'ischemia-infarction';
  state: 'supported-as-engineering-signal' | 'not-supported' | 'not-validated';
  explanation: string;
};

export type TomographyReconstruction = {
  version: 'tomography-coherent-backprojection-v1';
  status: 'available' | 'quality-rejected' | 'incompatible-captures';
  subjectCaptureId: string;
  backgroundCaptureId: string;
  grid: TomographyGrid;
  normalizedContrast: number[];
  peak?: TomographyPeak;
  estimatedRangeResolutionMeters: number;
  apertureCoverageDegrees: number;
  qualityGate: TomographyQualityGate;
  differentialMeasurementCount: number;
  claims: TomographyClaim[];
  warnings: string[];
};
