import type { ScanSession } from '@/domain/scanning';

import { encryptedStorage } from './encryptedStorage';

const PREFERENCES_KEY = 'app.preferences.v1';
const SESSION_PREFIX = 'scan.session.v1.';
const MAX_LOCAL_SESSIONS = 500;

type PersistedPreferences = {
  schemaVersion: 1;
  researchMode: boolean;
  updatedAt: string;
};

export type PersistedAppState = {
  researchMode?: boolean;
  sessions: ScanSession[];
};

export const appStateRepository = {
  descriptor: encryptedStorage.descriptor,

  async load(): Promise<PersistedAppState> {
    const [preferences, sessionRecords] = await Promise.all([
      encryptedStorage.get<PersistedPreferences>(PREFERENCES_KEY),
      encryptedStorage.list<ScanSession>(SESSION_PREFIX),
    ]);

    const sessions = sessionRecords
      .map(({ value }) => value)
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt));

    return {
      researchMode: preferences?.researchMode,
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
    const preferences: PersistedPreferences = {
      schemaVersion: 1,
      researchMode,
      updatedAt: new Date().toISOString(),
    };
    await encryptedStorage.set(PREFERENCES_KEY, preferences);
  },

  async clear() {
    await encryptedStorage.clear();
  },
};
