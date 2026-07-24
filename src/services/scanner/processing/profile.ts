import type { RawRadioFrame } from '@/domain/radio';

import { fft, hannWindow, magnitude, mean, phase, type Complex } from '../math/complex';

const SPEED_OF_LIGHT_METERS_PER_SECOND = 299_792_458;

export type BasicProfile = {
  profile: number[];
  spectra?: Complex[][];
  targetBin: number;
  targetRangeMeters?: number;
  targetPhaseRadians?: number;
};

const normalize = (values: number[]) => {
  const maximum = Math.max(...values, Number.EPSILON);
  return values.map((value) => value / maximum);
};

const extractChannel = (frame: RawRadioFrame, channel: number): Complex[] => {
  const samples: Complex[] = [];
  const start = channel * frame.samplesPerChannel * 2;
  for (let index = 0; index < frame.samplesPerChannel; index += 1) {
    samples.push({
      real: frame.samples[start + index * 2] ?? 0,
      imaginary: frame.samples[start + index * 2 + 1] ?? 0,
    });
  }
  return samples;
};

const dominantBin = (profile: number[], minimumBin = 1) => {
  let selected = minimumBin;
  for (let index = minimumBin + 1; index < profile.length; index += 1) {
    if ((profile[index] ?? 0) > (profile[selected] ?? 0)) selected = index;
  }
  return selected;
};

const computeFmcwProfile = (frame: RawRadioFrame): BasicProfile => {
  const window = hannWindow(frame.samplesPerChannel);
  const spectra = Array.from({ length: frame.channels }, (_, channel) => {
    const raw = extractChannel(frame, channel);
    const dcReal = mean(raw.map((sample) => sample.real));
    const dcImaginary = mean(raw.map((sample) => sample.imaginary));
    return fft(
      raw.map((sample, index) => ({
        real: (sample.real - dcReal) * window[index]!,
        imaginary: (sample.imaginary - dcImaginary) * window[index]!,
      })),
    ).slice(0, frame.samplesPerChannel / 2);
  });

  const magnitudeProfile = Array.from({ length: frame.samplesPerChannel / 2 }, (_, bin) =>
    mean(spectra.map((spectrum) => magnitude(spectrum[bin]!))),
  );
  const profile = normalize(magnitudeProfile);
  const targetBin = dominantBin(profile);
  const rangeResolution = SPEED_OF_LIGHT_METERS_PER_SECOND / (2 * frame.bandwidthHz);
  const phaseVector = spectra.reduce(
    (sum, spectrum) => ({
      real: sum.real + spectrum[targetBin]!.real,
      imaginary: sum.imaginary + spectrum[targetBin]!.imaginary,
    }),
    { real: 0, imaginary: 0 },
  );

  return {
    profile,
    spectra,
    targetBin,
    targetRangeMeters: targetBin * rangeResolution,
    targetPhaseRadians: phase(phaseVector),
  };
};

const computeDirectProfile = (frame: RawRadioFrame): BasicProfile => {
  const channelProfiles = Array.from({ length: frame.channels }, (_, channel) =>
    extractChannel(frame, channel).map(magnitude),
  );
  const magnitudeProfile = Array.from({ length: frame.samplesPerChannel }, (_, bin) =>
    mean(channelProfiles.map((profile) => profile[bin] ?? 0)),
  );
  const profile = normalize(magnitudeProfile);
  const targetBin = dominantBin(profile);
  const rangeResolution = frame.bandwidthHz > 0
    ? SPEED_OF_LIGHT_METERS_PER_SECOND / (2 * frame.bandwidthHz)
    : undefined;
  const target = extractChannel(frame, 0)[targetBin];

  return {
    profile,
    targetBin,
    targetRangeMeters: rangeResolution ? targetBin * rangeResolution : undefined,
    targetPhaseRadians: target ? phase(target) : undefined,
  };
};

export function computeBasicProfile(frame: RawRadioFrame): BasicProfile {
  if (frame.samplesPerChannel <= 0 || frame.channels <= 0) {
    throw new Error('Scanner frame has invalid dimensions.');
  }
  if (frame.samples.length !== frame.channels * frame.samplesPerChannel * 2) {
    throw new Error('Scanner frame payload does not match its dimensions.');
  }

  return frame.modality === 'mmwave-fmcw'
    ? computeFmcwProfile(frame)
    : computeDirectProfile(frame);
}
