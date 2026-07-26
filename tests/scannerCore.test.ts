import { describe, expect, it } from 'vitest';

import { generateSyntheticRadioFrame } from '@/services/scanner/emulator/syntheticScanner';
import { runScannerCoreDiagnostic } from '@/services/scanner/selfTest';
import { decodeRadioFrame, encodeRadioFrame } from '@/services/scanner/protocol/frameCodec';

describe('scanner core', () => {
  it('passes the deterministic scanner diagnostic', () => {
    const result = runScannerCoreDiagnostic();
    expect(result.passed).toBe(true);
    expect(result.targetRangeMeters).toBeGreaterThan(0.2);
    expect(result.targetRangeMeters).toBeLessThan(0.5);
  });

  it('rejects corrupted scanner packets', () => {
    const frame = generateSyntheticRadioFrame({
      sessionId: 'codec-test',
      sequence: 1,
      position: 'apex',
      elapsedSeconds: 0.1,
    });
    const packet = encodeRadioFrame(frame);
    packet[Math.floor(packet.length / 2)]! ^= 0xff;
    expect(() => decodeRadioFrame(packet)).toThrow(/CRC/);
  });
});
