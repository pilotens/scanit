export type StorageMode = 'encrypted-native' | 'memory-only';

export type StorageDescriptor = {
  mode: StorageMode;
  isPersistent: boolean;
  isEncrypted: boolean;
  label: string;
  description: string;
};

export type StoredRecord<T> = {
  key: string;
  value: T;
};

export interface EncryptedRecordStore {
  descriptor: StorageDescriptor;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  list<T>(prefix: string): Promise<StoredRecord<T>[]>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}
