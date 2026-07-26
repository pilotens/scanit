export type ScannerEvidenceLevel = 'supported' | 'weak' | 'unsupported' | 'blocked';

export type ScannerEvidenceMetric = {
  label: string;
  value: number;
  unit?: string;
};

export type ScannerEvidenceClaim = {
  id: string;
  label: string;
  level: ScannerEvidenceLevel;
  confidence: number;
  statement: string;
  supportingMetrics: ScannerEvidenceMetric[];
  caveats: string[];
};

export type ScannerInterpretation = {
  version: 'scanner-interpretation-v1';
  interpretedAt: string;
  overallConfidence: number;
  acquisitionState: 'valid' | 'repeat' | 'invalid';
  physicalTargetState: 'supported' | 'uncertain' | 'unsupported';
  periodicMotionState: 'supported' | 'uncertain' | 'unsupported';
  tissueInterpretationState: 'not-supported';
  medicalInterpretationState: 'not-validated';
  claims: ScannerEvidenceClaim[];
  blockedReasons: string[];
  summary: string;
};
