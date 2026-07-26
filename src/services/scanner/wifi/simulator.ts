import type { WifiCsiFrame, WifiSensingCapture } from '@/domain/wifiSensing';

const subcarrierIndices = [
  ...Array.from({ length: 28 }, (_, index) => index - 28),
  ...Array.from({ length: 28 }, (_, index) => index + 1),
];

const seededNoise = (seed: number) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return (value - Math.floor(value)) * 2 - 1;
};

export type SimulatedWifiCsiOptions = {
  id?: string;
  soundingCount?: number;
  calibrationSoundingCount?: number;
  soundingRateHz?: number;
  motionScale?: number;
  multipathDriftScale?: number;
  receiverNodeIds?: string[];
  soundingSessionNonce?: number;
};

export function simulateWifiCsiCapture(options: SimulatedWifiCsiOptions = {}): WifiSensingCapture {
  const id = options.id ?? `wifi-csi-${Date.now()}`;
  const soundingCount = options.soundingCount ?? 240;
  const calibrationSoundingCount = options.calibrationSoundingCount ?? 24;
  const soundingRateHz = options.soundingRateHz ?? 20;
  const receiverNodeIds = options.receiverNodeIds ?? ['rx-left', 'rx-right', 'rx-reference'];
  const motionScale = options.motionScale ?? 1;
  const multipathDriftScale = options.multipathDriftScale ?? 0.08;
  const soundingSessionNonce = options.soundingSessionNonce ?? 0x5343414e;
  const clockDomain = `wifi-sim-${id}`;
  const transmitterClockDomain = `wifi-sim-tx-${id}`;
  const startMonotonicNs = 2_000_000_000_000_000_000n;
  const startWallNs = 1_900_000_000_000_000_000n;
  const intervalNs = BigInt(Math.round(1_000_000_000 / soundingRateHz));
  const frames: WifiCsiFrame[] = [];
  let sequence = 0;

  for (let soundingSequence = 0; soundingSequence < soundingCount; soundingSequence += 1) {
    const elapsedSeconds = soundingSequence / soundingRateHz;
    const activeScale = soundingSequence < calibrationSoundingCount ? 0 : motionScale;
    const respiration = 0.34 * Math.sin(2 * Math.PI * 0.24 * elapsedSeconds) * activeScale;
    const cardiac =
      (0.065 * Math.sin(2 * Math.PI * 1.18 * elapsedSeconds) +
        0.022 * Math.sin(2 * Math.PI * 2.36 * elapsedSeconds)) *
      activeScale;
    const drift =
      multipathDriftScale * Math.sin(2 * Math.PI * 0.035 * elapsedSeconds) * activeScale;
    const transmitterTimestampNs = startMonotonicNs + BigInt(soundingSequence) * intervalNs;

    receiverNodeIds.forEach((rxNodeId, linkIndex) => {
      const linkSensitivity = [1, -0.72, 0.28][linkIndex] ?? 0.2;
      const staticPhase = [0.6, -0.85, 1.35][linkIndex] ?? linkIndex * 0.3;
      const staticGain = [1, 0.78, 0.58][linkIndex] ?? 0.5;
      const csi: number[] = [];

      for (const subcarrier of subcarrierIndices) {
        const subcarrierSlope = subcarrier * (0.021 + linkIndex * 0.004);
        const multipathRipple = 0.18 * Math.sin(subcarrier * 0.19 + linkIndex * 0.8);
        const phase =
          staticPhase +
          subcarrierSlope +
          multipathRipple +
          linkSensitivity * (respiration + cardiac) +
          drift * (0.5 + Math.abs(subcarrier) / 56);
        const magnitude =
          staticGain *
          (1 +
            0.025 * Math.sin(subcarrier * 0.13 + linkIndex) +
            activeScale * 0.012 * Math.sin(2 * Math.PI * 0.24 * elapsedSeconds));
        const seed = soundingSequence * 100_000 + linkIndex * 1_000 + subcarrier + 100;
        const noiseReal = seededNoise(seed) * 0.006;
        const noiseImaginary = seededNoise(seed + 17) * 0.006;
        csi.push(
          magnitude * Math.cos(phase) + noiseReal,
          magnitude * Math.sin(phase) + noiseImaginary,
        );
      }

      const receiverOffsetNs = BigInt(linkIndex * 80_000);
      const monotonicTimestampNs = transmitterTimestampNs + receiverOffsetNs;
      const wallClockUnixNs =
        startWallNs + BigInt(soundingSequence) * intervalNs + receiverOffsetNs;
      frames.push({
        schemaVersion: 1,
        frameId: `${id}-${soundingSequence}-${rxNodeId}`,
        sessionId: id,
        sequence: sequence++,
        soundingSequence,
        soundingIdSource: 'transmitter-payload',
        soundingSessionNonce,
        transmitterTimestampNs: String(transmitterTimestampNs),
        transmitterClockDomain,
        receiverDriverTimestampUs: Number((monotonicTimestampNs / 1_000n) & 0xffff_ffffn),
        soundingMarkerDeltaMicroseconds: linkIndex * 80,
        receiverDroppedRecordCount: 0,
        csi0Version: 2,
        csi0StatusFlags: 0x07,
        timestampNs: String(monotonicTimestampNs),
        timing: {
          clockDomain,
          timestampSource: 'synthetic-monotonic',
          monotonicTimestampNs: String(monotonicTimestampNs),
          wallClockUnixNs: String(wallClockUnixNs),
          uncertaintyNs: 120_000 + linkIndex * 80_000,
          anchorMonotonicNs: String(startMonotonicNs),
          anchorWallClockUnixNs: String(startWallNs),
        },
        txNodeId: 'tx-chest-reference',
        rxNodeId,
        txAntenna: 0,
        rxAntenna: 0,
        band: '5-ghz',
        channel: 36,
        centerFrequencyHz: 5_180_000_000,
        bandwidthHz: 20_000_000,
        phy: 'he',
        spatialStream: 0,
        subcarrierIndices: [...subcarrierIndices],
        csi,
        rssiDbm: -42 - linkIndex * 5 + seededNoise(soundingSequence + linkIndex) * 1.2,
        noiseFloorDbm: -94,
        packetSequence: soundingSequence,
        transmitterMac: '02:00:00:00:00:01',
        receiverMac: `02:00:00:00:01:0${linkIndex + 1}`,
        firmwareVersion: 'wifi-csi-simulator-v2',
        source: 'deterministic-wifi-csi-simulator',
        qualityFlags: [],
        isSimulated: true,
      });
    });
  }

  return {
    schemaVersion: 1,
    id,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    source: 'deterministic-wifi-csi-simulator',
    hardwareProfileId: 'esp32-c5-csi-array-simulator',
    frames,
    calibrationSoundingCount,
    tags: ['wifi-csi', 'simulated', 'explicit-sounding-id'],
    notes: [],
  };
}
