import type {
  RawRadioFrame,
  ScannerRxCalibration,
  ScannerRxCalibrationChannel,
} from '@/domain/radio';

import { clamp, magnitude, mean, phase, standardDeviation, wrapPhase, type Complex } from '../math/complex';
import { computeBasicProfile } from '../processing/profile';

const EPSILON = 1e-12;
const SPEED_OF_LIGHT_METERS_PER_SECOND = 299_792_458;

const averageComplex = (values: Complex[]): Complex => {
  if (!values.length) return { real: 0, imaginary: 0 };
  return {
    real: mean(values.map((value) => value.real)),
    imaginary: mean(values.map((value) => value.imaginary)),
  };
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
  return clamp(magnitude(sum) / usable.length);
};

const circularStandardDeviation = (values: Complex[]) => {
  const coherence = Math.max(unitCoherence(values), EPSILON);
  return Math.sqrt(Math.max(0, -2 * Math.log(coherence)));
};

const rotateAndScale = (value: Complex, gain: number, phaseOffset: number): Complex => {
  const cosine = Math.cos(phaseOffset);
  const sine = Math.sin(phaseOffset);
  return {
    real: gain * (value.real * cosine - value.imaginary * sine),
    imaginary: gain * (value.real * sine + value.imaginary * cosine),
  };
};

const selectCalibrationBin = (frames: RawRadioFrame[]) => {
  const profiles = frames.map((frame) => computeBasicProfile(frame));
  const length = Math.min(...profiles.map(({ profile }) => profile.length));
  const averageProfile = Array.from({ length }, (_, bin) =>
    mean(profiles.map(({ profile }) => profile[bin] ?? 0)),
  );
  let selected = Math.min(1, Math.max(0, averageProfile.length - 1));
  for (let bin = selected + 1; bin < averageProfile.length; bin += 1) {
    if ((averageProfile[bin] ?? 0) > (averageProfile[selected] ?? 0)) selected = bin;
  }
  return { profiles, targetBin: selected };
};

export function deriveRxCalibration(
  frames: RawRadioFrame[],
  hardwareProfileId: string,
): ScannerRxCalibration | undefined {
  const first = frames[0];
  if (!first || first.modality !== 'mmwave-fmcw' || first.channels < 2) return undefined;
  if (frames.length < 4) throw new Error('RX calibration requires at least four frames.');
  if (
    frames.some(
      (frame) =>
        frame.channels !== first.channels ||
        frame.antennaConfigurationId !== first.antennaConfigurationId ||
        frame.dataLayout !== first.dataLayout,
    )
  ) {
    throw new Error('RX calibration frames must use one stable antenna configuration.');
  }

  const { profiles, targetBin } = selectCalibrationBin(frames);
  const vectorsByChannel = Array.from({ length: first.channels }, () => [] as Complex[]);
  for (const profile of profiles) {
    if (!profile.chirpSpectra) continue;
    for (let channel = 0; channel < first.channels; channel += 1) {
      for (const spectrum of profile.chirpSpectra[channel] ?? []) {
        vectorsByChannel[channel]!.push(spectrum[targetBin] ?? { real: 0, imaginary: 0 });
      }
    }
  }

  const channelMeans = vectorsByChannel.map(averageComplex);
  const magnitudes = channelMeans.map(magnitude);
  const referenceRxChannel = magnitudes.reduce(
    (best, value, index) => (value > (magnitudes[best] ?? -Infinity) ? index : best),
    0,
  );
  const referenceMagnitude = Math.max(magnitudes[referenceRxChannel] ?? 0, EPSILON);
  const referencePhase = phase(channelMeans[referenceRxChannel] ?? { real: 0, imaginary: 0 });

  const channels: ScannerRxCalibrationChannel[] = vectorsByChannel.map((vectors, channel) => {
    const channelMagnitude = Math.max(magnitudes[channel] ?? 0, EPSILON);
    const amplitudes = vectors.map(magnitude);
    const amplitudeMean = mean(amplitudes);
    const amplitudeCoefficientOfVariation =
      amplitudeMean > EPSILON ? standardDeviation(amplitudes) / amplitudeMean : 1;
    const phaseStandardDeviationRadians = circularStandardDeviation(vectors);
    const measuredPhaseRadians = phase(channelMeans[channel] ?? { real: 0, imaginary: 0 });
    const gainCorrection = clamp(referenceMagnitude / channelMagnitude, 0.25, 4);
    const phaseCorrectionRadians = wrapPhase(referencePhase - measuredPhaseRadians);
    return {
      channel,
      gainCorrection,
      phaseCorrectionRadians,
      measuredMagnitude: channelMagnitude,
      measuredPhaseRadians,
      amplitudeCoefficientOfVariation,
      phaseStandardDeviationRadians,
      valid:
        channelMagnitude > EPSILON &&
        amplitudeCoefficientOfVariation <= 0.65 &&
        phaseStandardDeviationRadians <= 1.25,
    };
  });

  const coherenceBefore = unitCoherence(channelMeans);
  const correctedMeans = channelMeans.map((value, channel) => {
    const correction = channels[channel]!;
    return rotateAndScale(value, correction.gainCorrection, correction.phaseCorrectionRadians);
  });
  const coherenceAfter = unitCoherence(correctedMeans);
  const validRatio = channels.filter(({ valid }) => valid).length / channels.length;
  const stability = clamp(
    1 -
      mean(
        channels.map(({ amplitudeCoefficientOfVariation, phaseStandardDeviationRadians }) =>
          Math.min(1, amplitudeCoefficientOfVariation * 0.7 + phaseStandardDeviationRadians / Math.PI),
        ),
      ),
  );
  const improvement = clamp((coherenceAfter - coherenceBefore + 0.1) / 0.35);
  const qualityScore = Math.round(100 * (validRatio * 0.45 + stability * 0.3 + improvement * 0.25));
  const qualityFlags: string[] = [];
  if (validRatio < 1) qualityFlags.push('rx-calibration-channel-unstable');
  if (coherenceAfter < 0.7) qualityFlags.push('rx-calibration-residual-incoherence');
  if (qualityScore < 60) qualityFlags.push('rx-calibration-low-quality');

  const rangeResolution = first.bandwidthHz > 0
    ? SPEED_OF_LIGHT_METERS_PER_SECOND / (2 * first.bandwidthHz)
    : undefined;
  const temperatures = frames.flatMap(({ deviceTemperatureCelsius }) =>
    deviceTemperatureCelsius === undefined ? [] : [deviceTemperatureCelsius],
  );

  return {
    version: 'scanner-rx-calibration-v1',
    createdAt: new Date().toISOString(),
    hardwareProfileId,
    antennaConfigurationId: first.antennaConfigurationId,
    frameCount: frames.length,
    referenceRxChannel,
    targetBin,
    targetRangeMeters: rangeResolution ? targetBin * rangeResolution : undefined,
    channels,
    coherenceBefore,
    coherenceAfter,
    qualityScore,
    deviceTemperatureCelsius: temperatures.length ? mean(temperatures) : undefined,
    qualityFlags,
  };
}
