import type { RawRadioFrame, ScannerRxCalibration } from '@/domain/radio';

import { fft, hannWindow, magnitude, mean, phase, type Complex } from '../math/complex';

const SPEED_OF_LIGHT_METERS_PER_SECOND = 299_792_458;
const EPSILON = 1e-12;

export type BasicProfile = {
  profile: number[];
  /** Coherently averaged range spectrum per RX channel. */
  spectra?: Complex[][];
  /** Range spectrum per RX channel and chirp. */
  chirpSpectra?: Complex[][][];
  targetBin: number;
  targetRangeMeters?: number;
  targetPhaseRadians?: number;
  rxCoherence?: number;
  rxCoherenceBeforeCalibration?: number;
  chirpCoherence?: number;
  referenceRxChannel?: number;
  rxCalibrationApplied?: boolean;
  rxCalibrationQualityScore?: number;
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

const cubeDimensions = (frame: RawRadioFrame) => {
  const configuredChirps = frame.acquisition?.chirpsPerFrame ?? 1;
  const configuredSamples = frame.acquisition?.samplesPerChirp ?? frame.samplesPerChannel;
  const valid =
    frame.dataLayout === 'rx-chirp-sample' &&
    configuredChirps > 0 &&
    configuredSamples > 0 &&
    configuredChirps * configuredSamples === frame.samplesPerChannel;
  return valid
    ? { chirps: configuredChirps, samplesPerChirp: configuredSamples }
    : { chirps: 1, samplesPerChirp: frame.samplesPerChannel };
};

const extractCubeChirp = (
  frame: RawRadioFrame,
  channel: number,
  chirp: number,
  chirps: number,
  samplesPerChirp: number,
): Complex[] => {
  if (chirp < 0 || chirp >= chirps) throw new Error('FMCW chirp index is outside the frame.');
  const pointOffset = (channel * chirps + chirp) * samplesPerChirp;
  return Array.from({ length: samplesPerChirp }, (_, sample) => ({
    real: frame.samples[(pointOffset + sample) * 2] ?? 0,
    imaginary: frame.samples[(pointOffset + sample) * 2 + 1] ?? 0,
  }));
};

const dominantBin = (profile: number[], minimumBin = 1) => {
  let selected = Math.min(minimumBin, Math.max(0, profile.length - 1));
  for (let index = selected + 1; index < profile.length; index += 1) {
    if ((profile[index] ?? 0) > (profile[selected] ?? 0)) selected = index;
  }
  return selected;
};

const unitCoherence = (values: Complex[]) => {
  const usable = values.filter((value) => magnitude(value) > EPSILON);
  if (!usable.length) return 0;
  const sum = usable.reduce(
    (result, value) => {
      const scale = 1 / Math.max(magnitude(value), EPSILON);
      return {
        real: result.real + value.real * scale,
        imaginary: result.imaginary + value.imaginary * scale,
      };
    },
    { real: 0, imaginary: 0 },
  );
  return Math.min(1, magnitude(sum) / usable.length);
};

const averageComplex = (values: Complex[]) => {
  if (!values.length) return { real: 0, imaginary: 0 };
  return {
    real: mean(values.map((value) => value.real)),
    imaginary: mean(values.map((value) => value.imaginary)),
  };
};

const rangeFft = (raw: Complex[]) => {
  const window = hannWindow(raw.length);
  const dcReal = mean(raw.map((sample) => sample.real));
  const dcImaginary = mean(raw.map((sample) => sample.imaginary));
  return fft(
    raw.map((sample, index) => ({
      real: (sample.real - dcReal) * window[index]!,
      imaginary: (sample.imaginary - dcImaginary) * window[index]!,
    })),
  ).slice(0, raw.length / 2);
};

const calibrationMatches = (
  frame: RawRadioFrame,
  calibration: ScannerRxCalibration | undefined,
) =>
  Boolean(
    calibration &&
      calibration.antennaConfigurationId === frame.antennaConfigurationId &&
      calibration.channels.length >= frame.channels,
  );

const applyChannelCalibration = (
  value: Complex,
  channel: number,
  calibration: ScannerRxCalibration | undefined,
): Complex => {
  const correction = calibration?.channels[channel];
  if (!correction?.valid) return value;
  const cosine = Math.cos(correction.phaseCorrectionRadians);
  const sine = Math.sin(correction.phaseCorrectionRadians);
  return {
    real:
      correction.gainCorrection *
      (value.real * cosine - value.imaginary * sine),
    imaginary:
      correction.gainCorrection *
      (value.real * sine + value.imaginary * cosine),
  };
};

const computeFmcwProfile = (
  frame: RawRadioFrame,
  forcedTargetBin?: number,
  rxCalibration?: ScannerRxCalibration,
): BasicProfile => {
  const { chirps, samplesPerChirp } = cubeDimensions(frame);
  const rawChirpSpectra = Array.from({ length: frame.channels }, (_, channel) =>
    Array.from({ length: chirps }, (_, chirp) =>
      rangeFft(extractCubeChirp(frame, channel, chirp, chirps, samplesPerChirp)),
    ),
  );
  const calibrationApplied = calibrationMatches(frame, rxCalibration);
  const chirpSpectra = rawChirpSpectra.map((channelSpectra, channel) =>
    channelSpectra.map((spectrum) =>
      calibrationApplied
        ? spectrum.map((value) => applyChannelCalibration(value, channel, rxCalibration))
        : spectrum,
    ),
  );
  const binCount = Math.floor(samplesPerChirp / 2);
  const rawSpectra = rawChirpSpectra.map((channelSpectra) =>
    Array.from({ length: binCount }, (_, bin) =>
      averageComplex(channelSpectra.map((spectrum) => spectrum[bin] ?? { real: 0, imaginary: 0 })),
    ),
  );
  const spectra = chirpSpectra.map((channelSpectra) =>
    Array.from({ length: binCount }, (_, bin) =>
      averageComplex(channelSpectra.map((spectrum) => spectrum[bin] ?? { real: 0, imaginary: 0 })),
    ),
  );
  const magnitudeProfile = Array.from({ length: binCount }, (_, bin) =>
    mean(
      chirpSpectra.flatMap((channelSpectra) =>
        channelSpectra.map((spectrum) => magnitude(spectrum[bin] ?? { real: 0, imaginary: 0 })),
      ),
    ),
  );
  const profile = normalize(magnitudeProfile);
  const targetBin =
    forcedTargetBin !== undefined && forcedTargetBin >= 1 && forcedTargetBin < profile.length
      ? forcedTargetBin
      : dominantBin(profile);
  const rangeResolution = frame.bandwidthHz > 0
    ? SPEED_OF_LIGHT_METERS_PER_SECOND / (2 * frame.bandwidthHz)
    : undefined;

  const rawRxTargetVectors = rawSpectra.map(
    (spectrum) => spectrum[targetBin] ?? { real: 0, imaginary: 0 },
  );
  const rxTargetVectors = spectra.map(
    (spectrum) => spectrum[targetBin] ?? { real: 0, imaginary: 0 },
  );
  const rxMagnitudes = rxTargetVectors.map(magnitude);
  const strongestRxChannel = rxMagnitudes.reduce(
    (best, value, index) => (value > (rxMagnitudes[best] ?? -Infinity) ? index : best),
    0,
  );
  const referenceRxChannel =
    calibrationApplied && rxCalibration
      ? Math.min(rxCalibration.referenceRxChannel, frame.channels - 1)
      : strongestRxChannel;
  const referenceChirpVectors = chirpSpectra[referenceRxChannel]?.map(
    (spectrum) => spectrum[targetBin] ?? { real: 0, imaginary: 0 },
  ) ?? [];
  const referenceVector = averageComplex(referenceChirpVectors);

  return {
    profile,
    spectra,
    chirpSpectra,
    targetBin,
    targetRangeMeters: rangeResolution ? targetBin * rangeResolution : undefined,
    targetPhaseRadians: magnitude(referenceVector) > EPSILON ? phase(referenceVector) : undefined,
    rxCoherenceBeforeCalibration: unitCoherence(rawRxTargetVectors),
    rxCoherence: unitCoherence(rxTargetVectors),
    chirpCoherence: unitCoherence(referenceChirpVectors),
    referenceRxChannel,
    rxCalibrationApplied: calibrationApplied,
    rxCalibrationQualityScore: calibrationApplied ? rxCalibration?.qualityScore : undefined,
  };
};

const computeDirectProfile = (frame: RawRadioFrame, forcedTargetBin?: number): BasicProfile => {
  const channelProfiles = Array.from({ length: frame.channels }, (_, channel) =>
    extractChannel(frame, channel).map(magnitude),
  );
  const magnitudeProfile = Array.from({ length: frame.samplesPerChannel }, (_, bin) =>
    mean(channelProfiles.map((profile) => profile[bin] ?? 0)),
  );
  const profile = normalize(magnitudeProfile);
  const targetBin =
    forcedTargetBin !== undefined && forcedTargetBin >= 1 && forcedTargetBin < profile.length
      ? forcedTargetBin
      : dominantBin(profile);
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

export function computeBasicProfile(
  frame: RawRadioFrame,
  forcedTargetBin?: number,
  rxCalibration?: ScannerRxCalibration,
): BasicProfile {
  if (frame.samplesPerChannel <= 0 || frame.channels <= 0) {
    throw new Error('Scanner frame has invalid dimensions.');
  }
  if (frame.samples.length !== frame.channels * frame.samplesPerChannel * 2) {
    throw new Error('Scanner frame payload does not match its dimensions.');
  }

  return frame.modality === 'mmwave-fmcw'
    ? computeFmcwProfile(frame, forcedTargetBin, rxCalibration)
    : computeDirectProfile(frame, forcedTargetBin);
}
