import type { RawRadioFrame } from '@/domain/radio';

import { crc32 } from './crc32';

const MAGIC = [0x53, 0x43, 0x4e, 0x31] as const; // SCN1
const VERSION = 1;
const PREFIX_LENGTH = 12;
const CHECKSUM_LENGTH = 4;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type FrameHeader = Omit<RawRadioFrame, 'samples'> & { sampleCount: number };

export function encodeRadioFrame(frame: RawRadioFrame): Uint8Array {
  const expectedSamples = frame.channels * frame.samplesPerChannel * 2;
  if (frame.samples.length !== expectedSamples) {
    throw new Error(`Invalid sample length. Expected ${expectedSamples}, received ${frame.samples.length}.`);
  }

  const header: FrameHeader = {
    ...frame,
    sampleCount: frame.samples.length,
  };
  delete (header as Partial<RawRadioFrame>).samples;

  const headerBytes = encoder.encode(JSON.stringify(header));
  const payloadLength = frame.samples.length * Float32Array.BYTES_PER_ELEMENT;
  const totalLength = PREFIX_LENGTH + headerBytes.length + payloadLength + CHECKSUM_LENGTH;
  const packet = new Uint8Array(totalLength);
  const view = new DataView(packet.buffer);

  MAGIC.forEach((byte, index) => {
    packet[index] = byte;
  });
  view.setUint16(4, VERSION, true);
  view.setUint16(6, headerBytes.length, true);
  view.setUint32(8, payloadLength, true);
  packet.set(headerBytes, PREFIX_LENGTH);

  let payloadOffset = PREFIX_LENGTH + headerBytes.length;
  for (const value of frame.samples) {
    view.setFloat32(payloadOffset, value, true);
    payloadOffset += Float32Array.BYTES_PER_ELEMENT;
  }

  const checksumOffset = totalLength - CHECKSUM_LENGTH;
  view.setUint32(checksumOffset, crc32(packet.subarray(0, checksumOffset)), true);
  return packet;
}

export function decodeRadioFrame(packet: Uint8Array): RawRadioFrame {
  if (packet.length < PREFIX_LENGTH + CHECKSUM_LENGTH) {
    throw new Error('Scanner packet is too short.');
  }
  if (MAGIC.some((byte, index) => packet[index] !== byte)) {
    throw new Error('Scanner packet has an invalid magic value.');
  }

  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const version = view.getUint16(4, true);
  if (version !== VERSION) throw new Error(`Unsupported scanner packet version ${version}.`);

  const headerLength = view.getUint16(6, true);
  const payloadLength = view.getUint32(8, true);
  const checksumOffset = PREFIX_LENGTH + headerLength + payloadLength;
  if (checksumOffset + CHECKSUM_LENGTH !== packet.length) {
    throw new Error('Scanner packet length does not match its header.');
  }

  const expectedChecksum = view.getUint32(checksumOffset, true);
  const actualChecksum = crc32(packet.subarray(0, checksumOffset));
  if (actualChecksum !== expectedChecksum) throw new Error('Scanner packet CRC verification failed.');

  const header = JSON.parse(
    decoder.decode(packet.subarray(PREFIX_LENGTH, PREFIX_LENGTH + headerLength)),
  ) as FrameHeader;
  if (header.sampleCount * Float32Array.BYTES_PER_ELEMENT !== payloadLength) {
    throw new Error('Scanner packet sample count is inconsistent.');
  }

  const samples: number[] = [];
  let offset = PREFIX_LENGTH + headerLength;
  for (let index = 0; index < header.sampleCount; index += 1) {
    samples.push(view.getFloat32(offset, true));
    offset += Float32Array.BYTES_PER_ELEMENT;
  }

  const { sampleCount: _sampleCount, ...metadata } = header;
  return { ...metadata, samples };
}
