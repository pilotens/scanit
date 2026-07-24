import type { RawRadioFrame } from '@/domain/radio';
import type {
  ScannerLabSource,
  ScannerRecording,
  ScannerRecordingChunk,
  ScannerRecordingManifest,
} from '@/domain/scannerLab';
import { encryptedStorage } from '@/services/storage/encryptedStorage';

import { crc32 } from '../protocol/crc32';
import { decodeRadioFrame, encodeRadioFrame } from '../protocol/frameCodec';
import { base64ToBytes, bytesToBase64 } from './base64';

const MANIFEST_PREFIX = 'scanner.recording.manifest.v1.';
const CHUNK_PREFIX = 'scanner.recording.chunk.v1.';
const PACKETS_PER_CHUNK = 16;
const MAX_RECORDINGS = 40;
const MAX_RECORDING_BYTES = 32 * 1024 * 1024;

const manifestKey = (id: string) => `${MANIFEST_PREFIX}${id}`;
const chunkKey = (id: string, index: number) =>
  `${CHUNK_PREFIX}${id}.${String(index).padStart(5, '0')}`;

const concatenate = (packets: Uint8Array[]) => {
  const totalLength = packets.reduce((sum, packet) => sum + packet.length, 0);
  const joined = new Uint8Array(totalLength);
  let offset = 0;
  for (const packet of packets) {
    joined.set(packet, offset);
    offset += packet.length;
  }
  return joined;
};

export const computeAggregateCrc32 = (packets: Uint8Array[]) =>
  crc32(concatenate(packets)).toString(16).padStart(8, '0');

const estimateFrameRate = (frames: RawRadioFrame[]) => {
  if (frames.length < 2) return 0;
  try {
    const first = BigInt(frames[0]!.timestampNs);
    const last = BigInt(frames.at(-1)!.timestampNs);
    const elapsedSeconds = Number(last - first) / 1_000_000_000;
    return elapsedSeconds > 0 ? (frames.length - 1) / elapsedSeconds : 0;
  } catch {
    return 0;
  }
};

const sequenceGaps = (frames: RawRadioFrame[]) => {
  let gaps = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const difference = frames[index]!.sequence - frames[index - 1]!.sequence;
    if (difference > 1) gaps += difference - 1;
    if (difference <= 0) gaps += 1;
  }
  return gaps;
};

const unique = (values: string[]) => [...new Set(values)];

export type SaveScannerRecordingInput = {
  frames: RawRadioFrame[];
  label?: string;
  source: ScannerLabSource;
  sourceDescriptor: string;
  hardwareProfileId: string;
  calibrationFrameCount: number;
  tags?: string[];
  notes?: string[];
};

export const scannerRecordingRepository = {
  async save(input: SaveScannerRecordingInput): Promise<ScannerRecordingManifest> {
    const { frames } = input;
    if (frames.length < Math.max(6, input.calibrationFrameCount + 2)) {
      throw new Error('Recording requires calibration frames and at least two analysis frames.');
    }
    const first = frames[0]!;
    if (frames.some((frame) => frame.modality !== first.modality || frame.position !== first.position)) {
      throw new Error('A recording may contain only one modality and one scanner position.');
    }

    const packets = frames.map(encodeRadioFrame);
    const totalBytes = packets.reduce((sum, packet) => sum + packet.length, 0);
    if (totalBytes > MAX_RECORDING_BYTES) {
      throw new Error(`Scanner recording exceeds ${MAX_RECORDING_BYTES} bytes.`);
    }

    const id = `rf-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const createdAt = new Date().toISOString();
    const chunks: ScannerRecordingChunk[] = [];
    for (let index = 0; index < packets.length; index += PACKETS_PER_CHUNK) {
      const packetSlice = packets.slice(index, index + PACKETS_PER_CHUNK);
      chunks.push({
        schemaVersion: 1,
        recordingId: id,
        index: chunks.length,
        packetCount: packetSlice.length,
        packetsBase64: packetSlice.map(bytesToBase64),
      });
    }

    const manifest: ScannerRecordingManifest = {
      schemaVersion: 1,
      id,
      label: input.label?.trim() || `${first.position} ${createdAt.slice(0, 16)}`,
      createdAt,
      completedAt: new Date().toISOString(),
      source: input.source,
      sourceDescriptor: input.sourceDescriptor,
      modality: first.modality,
      position: first.position,
      hardwareProfileId: input.hardwareProfileId,
      protocolVersion: 1,
      processingVersion: 'scanner-pipeline-v1',
      frameCount: frames.length,
      calibrationFrameCount: input.calibrationFrameCount,
      dataChunkCount: chunks.length,
      totalBytes,
      aggregateCrc32: computeAggregateCrc32(packets),
      firstTimestampNs: first.timestampNs,
      lastTimestampNs: frames.at(-1)!.timestampNs,
      estimatedFrameRateHz: estimateFrameRate(frames),
      sequenceGaps: sequenceGaps(frames),
      qualityFlags: unique(frames.flatMap(({ qualityFlags }) => qualityFlags)),
      tags: unique(input.tags ?? []),
      notes: input.notes ?? [],
      isSimulated: frames.every(({ isSimulated }) => isSimulated),
    };

    const writtenKeys: string[] = [];
    try {
      for (const chunk of chunks) {
        const key = chunkKey(id, chunk.index);
        await encryptedStorage.set(key, chunk);
        writtenKeys.push(key);
      }
      await encryptedStorage.set(manifestKey(id), manifest);
      writtenKeys.push(manifestKey(id));
      await this.enforceRetention();
      return manifest;
    } catch (error) {
      await Promise.all(writtenKeys.map((key) => encryptedStorage.remove(key)));
      throw error;
    }
  },

  async list(): Promise<ScannerRecordingManifest[]> {
    const records = await encryptedStorage.list<ScannerRecordingManifest>(MANIFEST_PREFIX);
    return records
      .map(({ value }) => value)
      .filter(({ schemaVersion }) => schemaVersion === 1)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  async load(id: string): Promise<ScannerRecording> {
    const manifest = await encryptedStorage.get<ScannerRecordingManifest>(manifestKey(id));
    if (!manifest || manifest.schemaVersion !== 1) throw new Error('Scanner recording was not found.');

    const packets: Uint8Array[] = [];
    for (let index = 0; index < manifest.dataChunkCount; index += 1) {
      const chunk = await encryptedStorage.get<ScannerRecordingChunk>(chunkKey(id, index));
      if (!chunk || chunk.recordingId !== id || chunk.index !== index) {
        throw new Error(`Scanner recording chunk ${index} is missing or inconsistent.`);
      }
      if (chunk.packetCount !== chunk.packetsBase64.length) {
        throw new Error(`Scanner recording chunk ${index} has an invalid packet count.`);
      }
      packets.push(...chunk.packetsBase64.map(base64ToBytes));
    }

    if (packets.length !== manifest.frameCount) {
      throw new Error('Scanner recording frame count does not match its manifest.');
    }
    const totalBytes = packets.reduce((sum, packet) => sum + packet.length, 0);
    if (totalBytes !== manifest.totalBytes) throw new Error('Scanner recording byte length mismatch.');
    if (computeAggregateCrc32(packets) !== manifest.aggregateCrc32) {
      throw new Error('Scanner recording aggregate CRC verification failed.');
    }

    const frames = packets.map(decodeRadioFrame);
    if (frames.some((frame) => frame.position !== manifest.position || frame.modality !== manifest.modality)) {
      throw new Error('Scanner recording frames do not match the manifest.');
    }
    return { manifest, frames };
  },

  async remove(id: string): Promise<void> {
    const manifest = await encryptedStorage.get<ScannerRecordingManifest>(manifestKey(id));
    if (manifest) {
      await Promise.all(
        Array.from({ length: manifest.dataChunkCount }, (_, index) =>
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
