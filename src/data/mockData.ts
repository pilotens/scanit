import type {
  PersonalBaseline,
  SensorConnection,
  VitalSnapshot,
} from '@/domain/health';
import type { ScanSession } from '@/domain/scanning';

export const currentVitals: VitalSnapshot = {
  timestamp: new Date().toISOString(),
  heartRateBpm: 67,
  oxygenSaturationPercent: 98,
  hrvRmssdMs: 44,
  skinTemperatureCelsius: 33.4,
  motionState: 'still',
  signalQuality: 'excellent',
  isSimulated: true,
};

export const personalBaseline: PersonalBaseline = {
  restingHeartRateBpm: 64,
  oxygenSaturationPercent: 98,
  hrvRmssdMs: 47,
  skinTemperatureCelsius: 33.2,
  sampleDays: 21,
  updatedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
};

export const initialSensors: SensorConnection[] = [
  {
    id: 'wearable-demo',
    kind: 'wearable',
    name: 'ScanIt Watch Simulator',
    status: 'connected',
    batteryPercent: 82,
    primary: true,
    capabilities: ['PPG', 'SpO₂', 'ECG', 'IMU', 'Skin temperature'],
    simulated: true,
  },
  {
    id: 'rf-demo',
    kind: 'rf-scanner',
    name: 'ScanIt RF Module Simulator',
    status: 'connected',
    batteryPercent: 74,
    primary: false,
    capabilities: ['Wi-Fi CSI', 'UWB CIR', '60 GHz radar', 'IMU'],
    simulated: true,
  },
  {
    id: 'phone-demo',
    kind: 'phone',
    name: 'Phone Processing Unit',
    status: 'connected',
    primary: false,
    capabilities: ['Fusion', 'Local inference', 'Encrypted storage'],
    simulated: false,
  },
];

export const initialScanSessions: ScanSession[] = [
  {
    id: 'demo-scan-001',
    startedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 26 * 60 * 60 * 1000 + 92_000).toISOString(),
    phase: 'completed',
    wearableSnapshot: currentVitals,
    rfObservations: [],
    assessment: {
      level: 'normal',
      score: 18,
      confidence: 0.79,
      title: 'Inga tydliga avvikelser i demodata',
      summary: 'Signalerna låg nära den simulerade personliga baslinjen.',
      evidence: [
        {
          id: 'heart-rate',
          label: 'Vilopuls',
          value: '67 bpm',
          contribution: 'reassuring',
        },
        {
          id: 'signal-quality',
          label: 'Signalkvalitet',
          value: 'Utmärkt',
          contribution: 'reassuring',
        },
      ],
      generatedAt: new Date(Date.now() - 26 * 60 * 60 * 1000 + 92_000).toISOString(),
      medicalDisclaimer: 'Demodata. Resultatet är inte en medicinsk bedömning.',
    },
    overallSignalQuality: 'good',
    notes: ['Historikpost skapad som exempeldata.'],
    isSimulated: true,
  },
];
