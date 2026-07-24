import type { RiskAssessment, SignalQuality, VitalSnapshot } from './health';

export type ScanPhase =
  | 'idle'
  | 'preparing'
  | 'calibrating'
  | 'wearable-baseline'
  | 'rf-scan'
  | 'fusing'
  | 'completed'
  | 'failed';

export type RfPosition =
  | 'left-sternal'
  | 'apex'
  | 'right-reference'
  | 'upper-chest';

export type RfObservation = {
  position: RfPosition;
  signalQuality: SignalQuality;
  mechanicalRegularity: number;
  relativeReflectivity: number;
  baselineDelta: number;
  sampleCount: number;
  isSimulated: boolean;
};

export type ScanSession = {
  id: string;
  startedAt: string;
  completedAt: string;
  phase: 'completed' | 'failed';
  wearableSnapshot: VitalSnapshot;
  rfObservations: RfObservation[];
  assessment: RiskAssessment;
  overallSignalQuality: SignalQuality;
  notes: string[];
  isSimulated: boolean;
};

export type ScanProgressEvent = {
  phase: ScanPhase;
  progress: number;
  title: string;
  instruction: string;
  currentPosition?: RfPosition;
};
