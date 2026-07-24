import { Platform } from 'react-native';
import {
  getLatestHealthSnapshot,
  getRecentElectrocardiograms,
  isHealthDataAvailable,
  requestHealthAuthorization,
  type HealthKitQuantitySample,
} from 'scanit-healthkit';

import type { SignalQuality, VitalSnapshot } from '@/domain/health';
import type { HealthKitImportRecord } from '@/domain/onboarding';

const round = (value: number | undefined, decimals = 0): number | null => {
  if (value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const latestTimestamp = (samples: Array<HealthKitQuantitySample | undefined>, fallback: string) => {
  const timestamps = samples
    .map((sample) => sample?.endDate)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left));
  return timestamps[0] ?? fallback;
};

const deriveQuality = (availableMeasurements: number): SignalQuality => {
  if (availableMeasurements >= 4) return 'excellent';
  if (availableMeasurements >= 3) return 'good';
  if (availableMeasurements >= 1) return 'fair';
  return 'poor';
};

export const isHealthKitSupported = () =>
  Platform.OS === 'ios' && isHealthDataAvailable();

export async function requestAndImportHealthKit(): Promise<HealthKitImportRecord> {
  if (!isHealthKitSupported()) {
    throw new Error(
      'Apple Health kräver en iPhone med HealthKit och en signerad ScanIt-build som innehåller HealthKit-modulen.',
    );
  }

  const authorization = await requestHealthAuthorization();
  const [snapshot, electrocardiograms] = await Promise.all([
    getLatestHealthSnapshot(14),
    getRecentElectrocardiograms(20),
  ]);

  const samples = [
    snapshot.heartRate,
    snapshot.heartRateVariabilitySdnn,
    snapshot.oxygenSaturation,
    snapshot.sleepingWristTemperature,
  ];
  const availableMeasurements = samples.filter(Boolean).length;
  const sourceNames = Array.from(
    new Set(samples.map((sample) => sample?.sourceName).filter((name): name is string => Boolean(name))),
  );

  const vitalSnapshot: VitalSnapshot = {
    timestamp: latestTimestamp(samples, snapshot.importedAt),
    heartRateBpm: round(snapshot.heartRate?.value),
    oxygenSaturationPercent: round(snapshot.oxygenSaturation?.value, 1),
    hrvRmssdMs: null,
    hrvSdnnMs: round(snapshot.heartRateVariabilitySdnn?.value, 1),
    skinTemperatureCelsius: round(snapshot.sleepingWristTemperature?.value, 1),
    motionState: 'unknown',
    signalQuality: deriveQuality(availableMeasurements),
    source: 'healthkit',
    sourceName: sourceNames.join(', ') || 'Apple Health',
    isSimulated: false,
  };

  return {
    schemaVersion: 1,
    importedAt: snapshot.importedAt,
    authorizationRequested: authorization.requested,
    vitalSnapshot,
    electrocardiograms,
    sourceTypes: authorization.readTypes,
  };
}
