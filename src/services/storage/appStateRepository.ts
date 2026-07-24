import type { ScanSession } from '@/domain/scanning';
import type {
  ConsentRecord,
  HealthKitImportRecord,
  UserProfile,
} from '@/domain/onboarding';

import { encryptedStorage } from './encryptedStorage';

const PREFERENCES_KEY = 'app.preferences.v1';
const HEALTHKIT_IMPORT_KEY = 'healthkit.import.v1';
const SESSION_PREFIX = 'scan.session.v1.';
const MAX_LOCAL_SESSIONS = 500;

type PersistedPreferencesV1 = {
  schemaVersion: 1;
  researchMode: boolean;
  updatedAt: string;
};

type PersistedPreferencesV2 = {
  schemaVersion: 2;
  researchMode: boolean;
  profile?: UserProfile;
  consent?: ConsentRecord;
  updatedAt: string;
};

type PersistedPreferences = PersistedPreferencesV1 | PersistedPreferencesV2;

export type PersistedAppState = {
  researchMode?: boolean;
  profile?: UserProfile;
  consent?: ConsentRecord;
  healthKitImport?: HealthKitImportRecord;
  sessions: ScanSession[];
};

const readPreferences = async (): Promise<PersistedPreferencesV2> => {
  const existing = await encryptedStorage.get<PersistedPreferences>(PREFERENCES_KEY);
  if (existing?.schemaVersion === 2) return existing;

  return {
    schemaVersion: 2,
    researchMode: existing?.researchMode ?? true,
    updatedAt: new Date().toISOString(),
  };
};

const savePreferences = async (preferences: PersistedPreferencesV2) => {
  await encryptedStorage.set(PREFERENCESV2_KEY, preferences);
};

const PREFERENCESV2_KEY = PREFERENCES_KEY;

export const appStateRepository = {
  descriptor: encryptedStorage.descriptor,

  async load(): Promise<PersistedAppState> {
    const [preferences, healthKitImport, sessionRecords] = await Promise.all([
      readPreferences(),
      encryptedStorage.get<HealthKitImportRecord>(HEALTHKIT_IMPORT_KEY),
      encryptedStorage.list<ScanSession>(SESSION_PREFIX),
    ]);

    const sessions = sessionRecords
      .map(({ value }) => value)
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt));

    return {
      researchMode: preferences.researchMode,
      profile: preferences.profile,
      consent: preferences.consent,
      healthKitImport: healthKitImport ?? undefined,
      sessions,
    };
  },

  async saveSession(session: ScanSession) {
    await encryptedStorage.set(`${SESSION_PREFIX}${session.id}`, session);

    const records = await encryptedStorage.list<ScanSession>(SESSION_PREFIX);
    const overflow = records.slice(MAX_LOCAL_SESSIONS);
    await Promise.all(overflow.map(({ key }) => encryptedStorage.remove(key)));
  },

  async saveResearchMode(researchMode: boolean) {
    const preferences = await readPreferences();
    await savePreferences({
      ...preferences,
      researchMode,
      updatedAt: new Date().toISOString(),
    });
  },

  async saveOnboarding(profile: UserProfile, consent: ConsentRecord) {
    const preferences = await readPreferences();
    await savePreferences({
      ...preferences,
      profile,
      consent,
      updatedAt: new Date().toISOString(),
    });
  },

  async saveHealthKitImport(healthKitImport: HealthKitImportRecord) {
    await encryptedStorage.set(HEALTHKIT_IMPORT_KEY, healthKitImport);
  },

  async clear() {
    await encryptedStorage.clear();
  },
};
