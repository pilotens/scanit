# Data model

## Core entities

### VitalSnapshot

A timestamped wearable summary containing pulse, oxygen saturation, HRV, skin temperature, motion state, signal quality, and provenance.

### PersonalBaseline

A rolling personal reference profile. Baseline values must preserve time window, sample count, device version, and model version when real data is introduced.

### RfObservation

A position-specific RF result. The current fields are placeholders for future raw-data-derived metrics. Production measurements should reference immutable raw frames instead of storing only summaries.

### ScanSession

A complete extended scan containing wearable data, RF observations, quality, assessment, timestamps, and simulation provenance.

### RiskAssessment

A calibrated indication with level, score, confidence, evidence, disclaimer, and model version. It must not be represented as a diagnosis.

## Future raw radio frame

```ts
type RadioFrame = {
  timestampNs: bigint;
  radioType: 'wifi-csi' | 'bluetooth-cs' | 'uwb-cir' | 'mmwave';
  deviceId: string;
  frequenciesHz: number[];
  complexSamples: Array<{ real: number; imaginary: number }>;
  antennaConfigurationId: string;
  motionVector: { x: number; y: number; z: number };
  calibrationVersion: string;
  qualityFlags: string[];
};
```

Raw data will normally be stored in a compact binary format rather than JSON.
