import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

import type { EncryptedRecordStore } from './types';

const DATABASE_NAME = 'scanit-secure.db';
const KEYCHAIN_KEY = 'scanit.storage.aes-key.v1';
const SCHEMA_VERSION = 1;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let encryptionKeyPromise: Promise<AESEncryptionKey> | null = null;

const getDatabase = async () => {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (database) => {
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS encrypted_records (
          record_key TEXT PRIMARY KEY NOT NULL,
          ciphertext TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS encrypted_records_updated_at
          ON encrypted_records(updated_at DESC);
      `);
      return database;
    });
  }

  return databasePromise;
};

const getEncryptionKey = async () => {
  if (!encryptionKeyPromise) {
    encryptionKeyPromise = (async () => {
      const existingKey = await SecureStore.getItemAsync(KEYCHAIN_KEY);
      if (existingKey) {
        return AESEncryptionKey.import(existingKey, 'base64');
      }

      const generatedKey = await AESEncryptionKey.generate(256);
      const encodedKey = await generatedKey.encoded('base64');
      await SecureStore.setItemAsync(KEYCHAIN_KEY, encodedKey, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      return generatedKey;
    })();
  }

  return encryptionKeyPromise;
};

const additionalDataFor = (recordKey: string, schemaVersion = SCHEMA_VERSION) =>
  textEncoder.encode(`${recordKey}:schema-${schemaVersion}`);

const encrypt = async <T>(recordKey: string, value: T) => {
  const key = await getEncryptionKey();
  const plaintext = textEncoder.encode(JSON.stringify(value));
  const sealedData = await aesEncryptAsync(plaintext, key, {
    additionalData: additionalDataFor(recordKey),
  });
  const combined = await sealedData.combined('base64');

  if (typeof combined !== 'string') {
    throw new Error('Encrypted payload was not returned as base64.');
  }

  return combined;
};

const decrypt = async <T>(recordKey: string, ciphertext: string, schemaVersion: number) => {
  const key = await getEncryptionKey();
  const sealedData = AESSealedData.fromCombined(ciphertext);
  const plaintext = await aesDecryptAsync(sealedData, key, {
    additionalData: additionalDataFor(recordKey, schemaVersion),
    output: 'bytes',
  });

  if (typeof plaintext === 'string') {
    throw new Error('Decrypted payload was returned with an unexpected encoding.');
  }

  return JSON.parse(textDecoder.decode(plaintext)) as T;
};

type EncryptedRow = {
  record_key: string;
  ciphertext: string;
  schema_version: number;
};

export const encryptedStorage: EncryptedRecordStore = {
  descriptor: {
    mode: 'encrypted-native',
    isPersistent: true,
    isEncrypted: true,
    label: 'Krypterad lokal lagring',
    description: 'AES-256-GCM med en enhetsbunden nyckel i iOS Keychain eller Android Keystore.',
  },
  async get<T>(recordKey) {
    const database = await getDatabase();
    const row = await database.getFirstAsync<EncryptedRow>(
      'SELECT record_key, ciphertext, schema_version FROM encrypted_records WHERE record_key = ?',
      recordKey,
    );

    return row ? decrypt<T>(row.record_key, row.ciphertext, row.schema_version) : null;
  },
  async set<T>(recordKey, value) {
    const database = await getDatabase();
    const ciphertext = await encrypt(recordKey, value);

    await database.runAsync(
      `INSERT INTO encrypted_records (record_key, ciphertext, schema_version, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(record_key) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         schema_version = excluded.schema_version,
         updated_at = excluded.updated_at`,
      recordKey,
      ciphertext,
      SCHEMA_VERSION,
      new Date().toISOString(),
    );
  },
  async list<T>(prefix) {
    const database = await getDatabase();
    const rows = await database.getAllAsync<EncryptedRow>(
      `SELECT record_key, ciphertext, schema_version
       FROM encrypted_records
       WHERE record_key LIKE ?
       ORDER BY updated_at DESC`,
      `${prefix}%`,
    );

    return Promise.all(
      rows.map(async (row) => ({
        key: row.record_key,
        value: await decrypt<T>(row.record_key, row.ciphertext, row.schema_version),
      })),
    );
  },
  async remove(recordKey) {
    const database = await getDatabase();
    await database.runAsync('DELETE FROM encrypted_records WHERE record_key = ?', recordKey);
  },
  async clear() {
    const database = await getDatabase();
    await database.runAsync('DELETE FROM encrypted_records');
    await SecureStore.deleteItemAsync(KEYCHAIN_KEY);
    encryptionKeyPromise = null;
  },
};
