import type {
  WifiCsiCalibration,
  WifiCsiFrame,
  WifiCsiLinkCorrection,
} from '@/domain/wifiSensing';

const EPSILON = 1e-12;

type Complex = { real: number; imaginary: number };

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const standardDeviation = (values: number[]) => {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

const magnitude = (value: Complex) => Math.hypot(value.real, value.imaginary);
const phase = (value: Complex) => Math.atan2(value.imaginary, value.real);

const wrapPhase = (value: number) => {
  let wrapped = value;
  while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  while (wrapped < -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
};

const averageComplex = (values: Complex[]): Complex => ({
  real: mean(values.map((value) => value.real)),
  imaginary: mean(values.map((value) => value.imaginary)),
});

export const wifiLinkId = (frame: WifiCsiFrame) =>
  `${frame.txNodeId}|${frame.rxNodeId}|${frame.txAntenna}|${frame.rxAntenna}|${frame.spatialStream}`;

const frameComplex = (frame: WifiCsiFrame, index: number): Complex => ({
  real: frame.csi[index * 2] ?? 0,
  imaginary: frame.csi[index * 2 + 1] ?? 0,
});

const validateCalibrationFrames = (frames: WifiCsiFrame[]) => {
  const first = frames[0];
  if (!first) throw new Error('Wi-Fi CSI calibration contains no frames.');
  for (const frame of frames) {
    if (
      frame.band !== first.band ||
      frame.channel !== first.channel ||
      frame.bandwidthHz !== first.bandwidthHz
    ) {
      throw new Error('Wi-Fi CSI calibration must use one band, channel and bandwidth.');
    }
    if (
      frame.subcarrierIndices.length !== first.subcarrierIndices.length ||
      frame.subcarrierIndices.some((value, index) => value !== first.subcarrierIndices[index])
    ) {
      throw new Error('Wi-Fi CSI calibration frames use inconsistent subcarrier layouts.');
    }
    if (frame.csi.length !== frame.subcarrierIndices.length * 2) {
      throw new Error('Wi-Fi CSI calibration frame dimensions are inconsistent.');
    }
  }
};

export function deriveWifiCsiCalibration(
  frames: WifiCsiFrame[],
  calibrationSoundingCount: number,
): WifiCsiCalibration {
  const calibrationFrames = frames.filter(
    ({ soundingSequence }) => soundingSequence < calibrationSoundingCount,
  );
  validateCalibrationFrames(calibrationFrames);
  const first = calibrationFrames[0]!;
  const groups = new Map<string, WifiCsiFrame[]>();
  for (const frame of calibrationFrames) {
    const id = wifiLinkId(frame);
    const existing = groups.get(id) ?? [];
    existing.push(frame);
    groups.set(id, existing);
  }
  if (groups.size < 2) throw new Error('Wi-Fi CSI calibration requires at least two receiver links.');

  const links: WifiCsiLinkCorrection[] = [...groups.entries()].map(([linkId, linkFrames]) => {
    const baselineCsi: number[] = [];
    const magnitudeVariations: number[] = [];
    const phaseResiduals: number[] = [];
    for (let subcarrierIndex = 0; subcarrierIndex < first.subcarrierIndices.length; subcarrierIndex += 1) {
      const values = linkFrames.map((frame) => frameComplex(frame, subcarrierIndex));
      const baseline = averageComplex(values);
      baselineCsi.push(baseline.real, baseline.imaginary);
      const magnitudes = values.map(magnitude);
      const magnitudeMean = mean(magnitudes);
      magnitudeVariations.push(
        magnitudeMean > EPSILON ? standardDeviation(magnitudes) / magnitudeMean : 1,
      );
      const baselinePhase = phase(baseline);
      phaseResiduals.push(
        ...values.map((value) => wrapPhase(phase(value) - baselinePhase)),
      );
    }
    const magnitudeCoefficientOfVariation = mean(magnitudeVariations);
    const phaseResidualStandardDeviationRadians = standardDeviation(phaseResiduals);
    const sample = linkFrames[0]!;
    return {
      linkId,
      txNodeId: sample.txNodeId,
      rxNodeId: sample.rxNodeId,
      txAntenna: sample.txAntenna,
      rxAntenna: sample.rxAntenna,
      subcarrierIndices: [...sample.subcarrierIndices],
      baselineCsi,
      magnitudeCoefficientOfVariation,
      phaseResidualStandardDeviationRadians,
      valid:
        magnitudeCoefficientOfVariation <= 0.2 &&
        phaseResidualStandardDeviationRadians <= 0.35 &&
        baselineCsi.some((value) => Math.abs(value) > EPSILON),
    };
  });

  const averageLinkMagnitudes = links.map((link) =>
    mean(
      Array.from({ length: link.subcarrierIndices.length }, (_, index) =>
        Math.hypot(link.baselineCsi[index * 2] ?? 0, link.baselineCsi[index * 2 + 1] ?? 0),
      ),
    ),
  );
  const referenceLinkIndex = averageLinkMagnitudes.reduce(
    (best, value, index) => (value > (averageLinkMagnitudes[best] ?? -Infinity) ? index : best),
    0,
  );
  const validRatio = links.filter(({ valid }) => valid).length / links.length;
  const magnitudeStability = Math.max(
    0,
    1 - mean(links.map(({ magnitudeCoefficientOfVariation }) => magnitudeCoefficientOfVariation)) / 0.25,
  );
  const phaseStability = Math.max(
    0,
    1 - mean(links.map(({ phaseResidualStandardDeviationRadians }) => phaseResidualStandardDeviationRadians)) / 0.5,
  );
  const qualityScore = Math.round(100 * (validRatio * 0.45 + magnitudeStability * 0.25 + phaseStability * 0.3));
  const qualityFlags: string[] = [];
  if (validRatio < 1) qualityFlags.push('wifi-calibration-link-unstable');
  if (phaseStability < 0.6) qualityFlags.push('wifi-calibration-phase-unstable');
  if (qualityScore < 65) qualityFlags.push('wifi-calibration-low-quality');

  return {
    version: 'wifi-csi-calibration-v1',
    id: `wifi-cal-${Date.now()}-${first.sessionId}`,
    createdAt: new Date().toISOString(),
    sessionId: first.sessionId,
    packetCount: calibrationFrames.length,
    soundingCount: new Set(calibrationFrames.map(({ soundingSequence }) => soundingSequence)).size,
    band: first.band,
    channel: first.channel,
    bandwidthHz: first.bandwidthHz,
    referenceLinkId: links[referenceLinkIndex]!.linkId,
    links,
    qualityScore,
    qualityFlags,
  };
}

export function normalizeWifiCsiFrame(
  frame: WifiCsiFrame,
  calibration: WifiCsiCalibration,
): Complex[] {
  const correction = calibration.links.find(({ linkId }) => linkId === wifiLinkId(frame));
  if (!correction?.valid) throw new Error(`No valid Wi-Fi CSI calibration for link ${wifiLinkId(frame)}.`);
  if (
    correction.subcarrierIndices.length !== frame.subcarrierIndices.length ||
    correction.subcarrierIndices.some((value, index) => value !== frame.subcarrierIndices[index])
  ) {
    throw new Error('Wi-Fi CSI frame does not match its calibration subcarrier layout.');
  }
  return frame.subcarrierIndices.map((_, index) => {
    const sample = frameComplex(frame, index);
    const baseline = {
      real: correction.baselineCsi[index * 2] ?? 0,
      imaginary: correction.baselineCsi[index * 2 + 1] ?? 0,
    };
    const denominator = baseline.real ** 2 + baseline.imaginary ** 2;
    if (denominator <= EPSILON) return { real: 0, imaginary: 0 };
    return {
      real: (sample.real * baseline.real + sample.imaginary * baseline.imaginary) / denominator,
      imaginary: (sample.imaginary * baseline.real - sample.real * baseline.imaginary) / denominator,
    };
  });
}