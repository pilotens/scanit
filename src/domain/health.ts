export type RiskLevel = 'normal' | 'observe' | 'elevated' | 'urgent';
export type SignalQuality = 'poor' | 'fair' | 'good' | 'excellent';
export type MotionState = 'still' | 'light-motion' | 'active';

export type VitalSnapshot = {
  timestamp: string;
  heartRateBpm: number;
  oxygenSaturationPercent: number;
  hrvRmssdMs: number;
  skinTemperatureCelsius: number;
  motionState: MotionState;
  signalQuality: SignalQuality;
  isSimulated: boolean;
};

export type PersonalBaseline = {
  restingHeartRateBpm: number;
  oxygenSaturationPercent: number;
  hrvRmssdMs: number;
  skinTemperatureCelsius: number;
  sampleDays: number;
  updatedAt: string;
};

export type SensorKind = 'wearable' | 'rf-scanner' | 'phone';
export type ConnectionStatus = 'connected' | 'available' | 'disconnected';

export type SensorConnection = {
  id: string;
  kind: SensorKind;
  name: string;
  status: ConnectionStatus;
  batteryPercent?: number;
  primary: boolean;
  capabilities: string[];
  simulated: boolean;
};

export type RiskEvidence = {
  id: string;
  label: string;
  value: string;
  contribution: 'reassuring' | 'neutral' | 'concerning';
};

export type RiskAssessment = {
  level: RiskLevel;
  score: number;
  confidence: number;
  title: string;
  summary: string;
  evidence: RiskEvidence[];
  generatedAt: string;
  medicalDisclaimer: string;
};
