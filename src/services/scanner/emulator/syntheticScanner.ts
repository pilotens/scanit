import type { RadioModality, RawRadioFrame } from '@/domain/radio';
import type { RfPosition } from '@/domain/scanning';

const SPEED_OF_LIGHT_METERS_PER_SECOND = 299_792_458;

const positionRange: Record<RfPosition, number> = {
  'left-sternal': 0.34,
  apex: 0.31,
  'right-reference': 0.37,
  'upper-chest': 0.4,
};

const positionGain: Record<RfPosition, number> = {
  'left-sternal': 0.92,
  apex: 1,
  'right-reference': 0.72,
  'upper-chest': 0.78,
};

const seededNoise = (seed: number) => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
};

export type SyntheticFrameOptions = {
  sessionId: string;
  sequence: number;
  position: RfPosition;
  elapsedSeconds: number;
  modality?: RadioModality;
  motionScale?: number;
};

const generateFmcwSamples = (options: SyntheticFrameOptions) => {
  const channels = 3;
  const samplesPerChannel = 64;
  const sampleRateHz = 2_000_000;
  const bandwidthHz = 3_000_000_000;
  const centerFrequencyHz = 60_500_000_000;
  const chirpDuration = samplesPerChannel / sampleRateHz;
  const slope = bandwidthHz / chirpDuration;
  const wavelength = SPEED_OF_LIGHT_METERS_PER_SECOND / centerFrequencyHz;
  const baseRange = positionRange[options.position];
  const gain = positionGain[options.position];
  const motionScale = options.motionScale ?? 1;
  const respirationMeters = 0.0022 * Math.sin(2 * Math.PI * 0.24 * options.elapsedSeconds);
  const cardiacMeters =
    0.00024 * Math.sin(2 * Math.PI * 1.18 * options.elapsedSeconds) +
    0.00008 * Math.sin(2 * Math.PI * 2.36 * options.elapsedSeconds);
  const reflectors = [
    { range: baseRange + respirationMeters * motionScale, amplitude: 1 * gain },
    { range: baseRange + 0.018 + respirationMeters * 0.65 * motionScale, amplitude: 0.42 * gain },
    {
      range: baseRange + 0.058 + (respirationMeters * 0.25 + cardiacMeters) * motionScale,
      amplitude: 0.22 * gain,
    },
  ];
  const samples: number[] = [];

  for (let channel = 0; channel < channels; channel += 1) {
    for (let sample = 0; sample < samplesPerChannel; sample += 1) {
      let real = 0;
      let imaginary = 0;
      for (const [reflectorIndex, reflector] of reflectors.entries()) {
        const beatFrequency = (2 * slope * reflector.range) / SPEED_OF_LIGHT_METERS_PER_SECOND;
        const propagationPhase = (4 * Math.PI * reflector.range) / wavelength;
        const antennaPhase = channel * 0.17 + reflectorIndex * 0.11;
        const angle =
          (2 * Math.PI * beatFrequency * sample) / sampleRateHz + propagationPhase + antennaPhase;
        real += reflector.amplitude * Math.cos(angle);
        imaginary += reflector.amplitude * Math.sin(angle);
      }
      const seed = options.sequence * 100_000 + channel * 1_000 + sample;
      real += seededNoise(seed) * 0.025;
      imaginary += seededNoise(seed + 17) * 0.025;
      samples.push(real, imaginary);
    }
  }

  return { samples, channels, samplesPerChannel, sampleRateHz, bandwidthHz, centerFrequencyHz };
};

const generateDirectSamples = (options: SyntheticFrameOptions) => {
  const channels = options.modality === 'wifi-csi' ? 1 : 2;
  const samplesPerChannel = options.modality === 'wifi-csi' ? 64 : 128;
  const bandwidthHz = options.modality === 'wifi-csi' ? 40_000_000 : 1_500_000_000;
  const centerFrequencyHz = options.modality === 'wifi-csi' ? 5_500_000_000 : 7_500_000_000;
  const baseBin = options.modality === 'wifi-csi' ? 18 : 5;
  const cardiac = 0.14 * Math.sin(2 * Math.PI * 1.18 * options.elapsedSeconds) * (options.motionScale ?? 1);
  const samples: number[] = [];

  for (let channel = 0; channel < channels; channel += 1) {
    for (let bin = 0; bin < samplesPerChannel; bin += 1) {
      const distance = bin - baseBin;
      const amplitude =
        Math.exp(-(distance ** 2) / 5) +
        0.35 * Math.exp(-((bin - baseBin - 7) ** 2) / 9) +
        Math.abs(seededNoise(options.sequence * 10_000 + channel * 500 + bin)) * 0.015;
      const angle = cardiac + bin * 0.035 + channel * 0.14;
      samples.push(amplitude * Math.cos(angle), amplitude * Math.sin(angle));
    }
  }

  return {
    samples,
    channels,
    samplesPerChannel,
    sampleRateHz: 1_000,
    bandwidthHz,
    centerFrequencyHz,
  };
};

export function generateSyntheticRadioFrame(options: SyntheticFrameOptions): RawRadioFrame {
  const modality = options.modality ?? 'mmwave-fmcw';
  const generated = modality === 'mmwave-fmcw'
    ? generateFmcwSamples({ ...options, modality })
    : generateDirectSamples({ ...options, modality });

  return {
    frameId: `${options.sessionId}-${options.sequence}`,
    sessionId: options.sessionId,
    sequence: options.sequence,
    timestampNs: String(BigInt(Date.now()) * 1_000_000n + BigInt(options.sequence)),
    modality,
    position: options.position,
    ...generated,
    antennaConfigurationId: modality === 'mmwave-fmcw' ? '1tx-3rx-l-array' : 'synthetic-direct',
    deviceTemperatureCelsius: 31.8,
    imu: {
      acceleration: { x: 0.002, y: -0.001, z: 0.003 },
      angularVelocity: { x: 0.001, y: 0.001, z: -0.001 },
    },
    qualityFlags: [],
    isSimulated: true,
  };
}
