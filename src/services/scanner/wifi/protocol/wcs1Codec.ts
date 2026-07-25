import type { WifiCsiFrame } from '@/domain/wifiSensing';

import { crc32 } from '../../protocol/crc32';

const MAGIC = [0x57, 0x43, 0x53, 0x31] as const; // WCS1
const VERSION = 1;
const PREFIX_LENGTH = 12;
const CHECKSUM_LENGTH = 4;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type WifiFrameHeader = Omit<WifiCsiFrame, 'csi'> & { complexValueCount: number };

export function encodeWifiCsiFrame(frame: WifiCsiFrame): Uint8Array {
  const expectedValues = frame.subcarrierIndices.length * 2;
  if (frame.schemaVersion !== 1) throw new Error('Unsupported Wi-Fi CSI schema version.');
  if (frame.csi.length !== expectedValues) {
    throw new Error(`Invalid CSI length. Expected ${expectedValues}, received ${frame.csi.length}.`);
  }
  if (!frame.subcarrierIndices.length) throw new Error('Wi-Fi CSI frame contains no subcarriers.');
  if (frame.csi.some((value) => !Number.isFinite(value))) {
    throw new Error('Wi-Fi CSI frame contains non-finite values.');
  }

  const header: WifiFrameHeader = {
    ...frame,
    complexValueCount: frame.csi.length,
  };
  delete (header as Partial<WifiCsiFrame>).csi;
  const headerBytes = encoder.encode(JSON.stringify(header));
  if (headerBytes.length > 0xffff) throw new Error('WCS1 metadata exceeds the header limit.');

  const payloadLength = frame.csi.length * Float32Array.BYTES_PER_ELEMENT;
  const packet = new Uint8Array(PREFIX_LENGTH + headerBytes.length + payloadLength + CHECKSUM_LENGTH);
  const view = new DataView(packet.buffer);
  MAGIC.forEach((byte, index) => {
    packet[index] = byte;
  });
  view.setUint16(4, VERSION, true);
  view.setUint16(6, headerBytes.length, true);
  view.setUint32(8, payloadLength, true);
  packet.set(headerBytes, PREFIX_LENGTH);

  let offset = PREFIX_LENGTH + headerBytes.length;
  for (const value of frame.csi) {
    view.setFloat32(offset, value, true);
    offset += Float32Array.BYTES_PER_ELEMENT;
  }
  view.setUint32(offset, crc32(packet.subarray(0, offset)), true);
  return packet;
}

export function decodeWifiCsiFrame(packet: Uint8Array): WifiCsiFrame {
  if (packet.length < PREFIX_LENGTH + CHECKSUM_LENGTH) throw new Error('WCS1 packet is too short.');
  if (MAGIC.some((byte, index) => packet[index] !== byte)) throw new Error('Invalid WCS1 magic value.');

  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const version = view.getUint16(4, true);
  if (version !== VERSION) throw new Error(`Unsupported WCS1 version ${version}.`);
  const headerLength = view.getUint16(6, true);
  const payloadLength = view.getUint32(8, true);
  const checksumOffset = PREFIX_LENGTH + headerLength + payloadLength;
  if (checksumOffset + CHECKSUM_LENGTH !== packet.length) {
    throw new Error('WCS1 packet length does not match its header.');
  }
  const expectedCrc = view.getUint32(checksumOffset, true);
  const actualCrc = crc32(packet.subarray(0, checksumOffset));
  if (actualCrc !== expectedCrc) throw new Error('WCS1 CRC verification failed.');

  const header = JSON.parse(
    decoder.decode(packet.subarray(PREFIX_LENGTH, PREFIX_LENGTH + headerLength)),
  ) as WifiFrameHeader;
  if (header.complexValueCount * Float32Array.BYTES_PER_ELEMENT !== payloadLength) {
    throw new Error('WCS1 complex-value count is inconsistent.');
  }
  if (header.complexValueCount !== header.subcarrierIndices.length * 2) {
    throw new Error('WCS1 subcarrier dimensions are inconsistent.');
  }

  const csi: number[] = [];
  let offset = PREFIX_LENGTH + headerLength;
  for (let index = 0; index < header.complexValueCount; index += 1) {
    csi.push(view.getFloat32(offset, true));
    offset += Float32Array.BYTES_PER_ELEMENT;
  }
  const { complexValueCount: _complexValueCount, ...metadata } = header;
  return { ...metadata, csi };
}