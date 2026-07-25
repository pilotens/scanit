import type {
  TomographyCapture,
  TomographyPathMeasurement,
} from '@/domain/tomography';
import { encryptedStorage } from '@/services/storage/encryptedStorage';

import { crc32 } from '../protocol/crc32';
import { validateTomographyCapture } from './validation';

const MANIFEST_PREFIX = 'scanner.tomography.manifest.v1.';
const CHUNK_PREFIX = 'scanner.tomography.chunk.v1.';
const MEASUREMENTS_PER_CHUNK = 256;
const MAX_CAPTURES = 24;

const manifestKey = (id: string) => `${MANIFEST_PREFIX}${id}`;
const chunkKey = (id: string, index: number) =>
  `${CHUNK_PREFIX}${id}.${String(index).padStart(5, '0')}`;

export type TomographyCaptureManifest = Omit<TomographyCapture, 'measurements'> & {
  measurementCount: number;
  chunkCount: number;
  aggregateCrc32: string;
};

type TomographyCaptureChunk = {
  schemaVersion: 1;
  captureId: string;
  index: number;
  measurements: TomographyPathMeasurement[];
};

const measurementBytes = (measurements: TomographyPathMeasurement[]) =>
  new TextEncoder().encode(JSON.stringify(measurements));

const aggregateChecksum = (measurements: TomographyPathMeasurement[]) =>
  crc32(measurementBytes(measurements)).toString(16).padStart(8, '0');

export const tomographyCaptureRepository = {
  async save(capture: TomographyCapture): Promise<TomographyCaptureManifest> {
    const validation = validateTomographyCapture(capture);
    if (!validation.valid) {
      throw new Error(`Invalid tomography capture: ${validation.errors.join(' ')}`);
    }
    const existing = await encryptedStorage.get<TomographyCaptureManifest>(
      manifestKey(capture.id),
    );
    if (existing) throw new Error(`Tomography capture ${capture.id} already exists.`);

    const chunks: TomographyCaptureChunk[] = [];
    for (
      let index = 0;
      index < capture.measurements.length;
      index += MEASUREMENTS_PER_CHUNK
    ) {
      chunks.push({
        schemaVersion: 1,
        captureId: capture.id,
        index: chunks.length,
        measurements: capture.measurements.slice(
          index,
          index + MEASUREMENTS_PER_CHUNK,
        ),
      });
    }
    const { measurements, ...metadata } = capture;
    const manifest: TomographyCaptureManifest = {
      ...metadata,
      measurementCount: measurements.length,
      chunkCount: chunks.length,
      aggregateCrc32: aggregateChecksum(measurements),
    };
    const writtenKeys: string[] = [];
    try {
      for (const chunk of chunks) {
        const key = chunkKey(capture.id, chunk.index);
        await encryptedStorage.set(key, chunk);
        writtenKeys.push(key);
      }
      await encryptedStorage.set(manifestKey(capture.id), manifest);
      writtenKeys.push(manifestKey(capture.id));
      await this.enforceRetention();
      return manifest;
    } catch (error) {
      await Promise.all(writtenKeys.map((key) => encryptedStorage.remove(key)));
      throw error;
    }
  },

  async list(): Promise<TomographyCaptureManifest[]> {
    const stored = await encryptedStorage.list<TomographyCaptureManifest>(
      MANIFEST_PREFIX,
    );
    return stored
      .map(({ value }) => value)
      .filter(({ schemaVersion }) => schemaVersion === 1)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  async load(id: string): Promise<TomographyCapture> {
    const manifest = await encryptedStorage.get<TomographyCaptureManifest>(
      manifestKey(id),
    );
    if (!manifest) throw new Error(`Tomography capture ${id} was not found.`);
    const measurements: TomographyPathMeasurement[] = [];
    for (let index = 0; index < manifest.chunkCount; index += 1) {
      const chunk = await encryptedStorage.get<TomographyCaptureChunk>(
        chunkKey(id, index),
      );
      if (
        !chunk ||
        chunk.schemaVersion !== 1 ||
        chunk.captureId !== id ||
        chunk.index !== index
      ) {
        throw new Error(`Tomography capture chunk ${index} is missing or inconsistent.`);
      }
      measurements.push(...chunk.measurements);
    }
    if (measurements.length !== manifest.measurementCount) {
      throw new Error('Tomography measurement count does not match the manifest.');
    }
    if (aggregateChecksum(measurements) !== manifest.aggregateCrc32) {
      throw new Error('Tomography capture aggregate CRC verification failed.');
    }
    const {
      measurementCount: _measurementCount,
      chunkCount: _chunkCount,
      aggregateCrc32: _aggregateCrc32,
      ...metadata
    } = manifest;
    const capture: TomographyCapture = { ...metadata, measurements };
    const validation = validateTomographyCapture(capture);
    if (!validation.valid) {
      throw new Error(`Stored tomography capture is invalid: ${validation.errors.join(' ')}`);
    }
    return capture;
  },

  async remove(id: string): Promise<void> {
    const manifest = await encryptedStorage.get<TomographyCaptureManifest>(
      manifestKey(id),
    );
    if (manifest) {
      await Promise.all(
        Array.from({ length: manifest.chunkCount }, (_, index) =>
          encryptedStorage.remove(chunkKey(id, index)),
        ),
      );
    }
    await encryptedStorage.remove(manifestKey(id));
  },

  async clear(): Promise<void> {
    const manifests = await this.list();
    await Promise.all(manifests.map(({ id }) => this.remove(id)));
  },

  async enforceRetention(): Promise<void> {
    const manifests = await this.list();
    await Promise.all(manifests.slice(MAX_CAPTURES).map(({ id }) => this.remove(id)));
  },
};
