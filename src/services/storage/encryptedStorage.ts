import type { EncryptedRecordStore } from './types';

const records = new Map<string, string>();

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Safe web/demo fallback. It deliberately avoids browser persistence because
 * there is no OS-backed key store equivalent to SecureStore on the web.
 * Native bundles resolve encryptedStorage.native.ts instead.
 */
export const encryptedStorage: EncryptedRecordStore = {
  descriptor: {
    mode: 'memory-only',
    isPersistent: false,
    isEncrypted: false,
    label: 'Tillfälligt webbminne',
    description: 'Webbdemon sparar inget efter omladdning. Native-appen använder krypterad lokal lagring.',
  },
  async get<T>(key) {
    const value = records.get(key);
    return value ? clone(JSON.parse(value) as T) : null;
  },
  async set<T>(key, value) {
    records.set(key, JSON.stringify(clone(value)));
  },
  async list<T>(prefix) {
    return [...records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value: clone(JSON.parse(value) as T) }));
  },
  async remove(key) {
    records.delete(key);
  },
  async clear() {
    records.clear();
  },
};
