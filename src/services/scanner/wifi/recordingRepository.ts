import type {
  WifiSensingCapture,
  WifiSensingRecordingManifest,
} from '@/domain/wifiSensing';
import { encryptedStorage } from '@/services/storage/encryptedStorage';

import { bytesToBase64, base64ToBytes } from '../recording/base64';
import { crc32 } from '../protocol/crc32';
import { assertWifiCaptureProvenance } from './provenance';
import { decodeWifiCsiFrame, encodeWifiCsiFrame } from './protocol/wcs1Codec';

const MANIFEST_PREFIX = 'scanner.wifi.manifest.v1.';
const CHUNK_PREFIX = 'scanner.wifi.chunk.v1.';
const FRAMES_PER_CHUNK = 12;
const MAX_RECORDINGS = 30;
const MAX_RECORDING_BYTES = 64 * 1024 * 1024;

const manifestKey = (id: string) => `${MANIFEST_PREFIX}${id}`;
const chunkKey = (id: string, index: number) =>
  `${CHUNK_PREFIX}${id}.${String(index).padStart(5, '0')}`;

type WifiRecordingChunk = {
  schemaVersion: 1;
  recordingId: string;
  index: number;
  packetCount: number;
  packetsBase64: string[];
};

const aggregateCrc = (packets: Uint8Array[]) => {
  let current = 0;
  for (const packet of packets) {
    const joined = new Uint8Array(4 + packet.length);
    const view = new DataView(joined.buffer);
    view.setUint32(0, current, true);
    joined.set(packet, 4);
    current = crc32(joined);
  }
  return current.toString(16).padStart(8, '0');
};

const unique = (values: string[]) => [...new Set(values)];

export const wifiSensingRecordingRepository = {
  async save(capture: WifiSensingCapture): Promise<WifiSensingRecordingManifest> {
    if (capture.schemaVersion !== 1) throw new Error('Unsupported Wi-Fi sensing capture schema.');
    if (capture.frames.length < capture.calibrationSoundingCount * 2 + 20) {
      throw new Error('Wi-Fi sensing capture is too short for calibration and analysis.');
    }
    const provenance = assertWifiCaptureProvenance(capture);
    const packets = capture.frames.map(encodeWifiCsiFrame);
    const totalBytes = packets.reduce((sum, packet) => sum + packet.length, 0);
    if (totalBytes > MAX_RECORDING_BYTES) {
      throw new Error(`Wi-Fi sensing recording exceeds ${MAX_RECORDING_BYTES} bytes.`);
    }
    const chunks: WifiRecordingChunk[] = [];
    for (let index = 0; index < packets.length; index += FRAMES_PER_CHUNK) {
      const slice = packets.slice(index, index + FRAMES_PER_CHUNK);
      chunks.push({
        schemaVersion: 1,
        recordingId: capture.id,
        index: chunks.length,
        packetCount: slice.length,
        packetsBase64: slice.map(bytesToBase64),
      });
    }
    const first = capture.frames[0]!;
    const last = capture.frames.at(-1)!;
    const soundingCount = new Set(capture.frames.map(({ soundingSequence }) => soundingSequence)).size;
    const manifest: WifiSensingRecordingManifest = {
      schemaVersion: 1,
      id: capture.id,
      createdAt: capture.createdAt,
      completedAt: capture.completedAt,
      source: capture.source,
      hardwareProfileId: capture.hardwareProfileId,
      frameCount: capture.frames.length,
      soundingCount,
      calibrationSoundingCount: capture.calibrationSoundingCount,
      chunkCount: chunks.length,
      totalBytes,
      aggregateCrc32: aggregateCrc(packets),
      firstTimestampNs: first.timing?.monotonicTimestampNs ?? first.timestampNs,
      lastTimestampNs: last.timing?.monotonicTimestampNs ?? last.timestampNs,
      qualityFlags: unique([
        ...capture.frames.flatMap(({ qualityFlags }) => qualityFlags),
        provenance.physical ? 'physical-provenance-verified' : 'simulated-provenance',
      ]),
      tags: unique(capture.tags),
      notes: capture.notes,
      isSimulated: capture.frames.every(({ isSimulated }) => isSimulated),
    };

    const written: string[] = [];
    try {
      for (const chunk of chunks) {
        const key = chunkKey(capture.id, chunk.index);
        await encryptedStorage.set(key, chunk);
        written.push(key);
      }
      await encryptedStorage.set(manifestKey(capture.id), manifest);
      written.push(manifestKey(capture.id));
      await this.enforceRetention();
      return manifest;
    } catch (error) {
      await Promise.all(written.map((key) => encryptedStorage.remove(key)));
      throw error;
    }
  },

  async list(): Promise<WifiSensingRecordingManifest[]> {
    const records = await encryptedStorage.list<WifiSensingRecordingManifest>(MANIFEST_PREFIX);
    return records
      .map(({ value }) => value)
      .filter(({ schemaVersion }) => schemaVersion === 1)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  async load(id: string): Promise<WifiSensingCapture> {
    const manifest = await encryptedStorage.get<WifiSensingRecordingManifest>(manifestKey(id));
    if (!manifest || manifest.schemaVersion !== 1) throw new Error('Wi-Fi sensing recording was not found.');
    const packets: Uint8Array[] = [];
    for (let index = 0; index < manifest.chunkCount; index += 1) {
      const chunk = await encryptedStorage.get<WifiRecordingChunk>(chunkKey(id, index));
      if (!chunk || chunk.recordingId !== id || chunk.index !== index) {
        throw new Error(`Wi-Fi sensing recording chunk ${index} is missing or inconsistent.`);
      }
      if (chunk.packetCount !== chunk.packetsBase64.length) {
        throw new Error(`Wi-Fi sensing recording chunk ${index} has an invalid packet count.`);
      }
      packets.push(...chunk.packetsBase64.map(base64ToBytes));
    }
    if (packets.length !== manifest.frameCount) {
      throw new Error('Wi-Fi sensing frame count does not match its manifest.');
    }
    const totalBytes = packets.reduce((sum, packet) => sum + packet.length, 0);
    if (totalBytes !== manifest.totalBytes) throw new Error('Wi-Fi sensing byte length mismatch.');
    if (aggregateCrc(packets) !== manifest.aggregateCrc32) {
      throw new Error('Wi-Fi sensing aggregate CRC verification failed.');
    }
    const frames = packets.map(decodeWifiCsiFrame);
    if (frames.some(({ sessionId }) => sessionId !== id)) {
      throw new Error('Wi-Fi sensing frames do not match the manifest session.');
    }
    const capture: WifiSensingCapture = {
      schemaVersion: 1,
      id,
      createdAt: manifest.createdAt,
      completedAt: manifest.completedAt,
      source: manifest.source,
      hardwareProfileId: manifest.hardwareProfileId,
      frames,
      calibrationSoundingCount: manifest.calibrationSoundingCount,
      tags: manifest.tags,
      notes: manifest.notes,
    };
    assertWifiCaptureProvenance(capture);
    return capture;
  },

  async remove(id: string): Promise<void> {
    const manifest = await encryptedStorage.get<WifiSensingRecordingManifest>(manifestKey(id));
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
    await Promise.all(manifests.slice(MAX_RECORDINGS).map(({ id }) => this.remove(id)));
  },
};
