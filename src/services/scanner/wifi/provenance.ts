import type { WifiCsiFrame, WifiSensingCapture } from '@/domain/wifiSensing';

const unique = <T,>(values: T[]) => [...new Set(values)];

export type WifiCaptureProvenanceAssessment = {
  version: 'wifi-capture-provenance-v1';
  physical: boolean;
  frameCount: number;
  explicitFrameRatio: number;
  soundingSessionNonces: number[];
  maximumMarkerDeltaMicroseconds?: number;
  receiverDroppedRecordCount: number;
  truncatedFrameCount: number;
  fallbackFrameCount: number;
  valid: boolean;
  reasons: string[];
};

export function assessWifiCaptureProvenance(
  frames: WifiCsiFrame[],
): WifiCaptureProvenanceAssessment {
  const physical = frames.some(({ isSimulated }) => !isSimulated);
  const explicitFrames = frames.filter(
    ({ soundingIdSource, soundingSessionNonce }) =>
      soundingIdSource === 'transmitter-payload' && soundingSessionNonce !== undefined,
  );
  const explicitFrameRatio = explicitFrames.length / Math.max(1, frames.length);
  const soundingSessionNonces = unique(
    explicitFrames.flatMap(({ soundingSessionNonce }) =>
      soundingSessionNonce === undefined ? [] : [soundingSessionNonce],
    ),
  );
  const markerDeltas = explicitFrames.flatMap(({ soundingMarkerDeltaMicroseconds }) =>
    soundingMarkerDeltaMicroseconds === undefined
      ? []
      : [Math.abs(soundingMarkerDeltaMicroseconds)],
  );
  const maximumMarkerDeltaMicroseconds = markerDeltas.length
    ? Math.max(...markerDeltas)
    : undefined;
  const receiverDroppedRecordCount = Math.max(
    ...frames.map(({ receiverDroppedRecordCount }) => receiverDroppedRecordCount ?? 0),
    0,
  );
  const truncatedFrameCount = frames.filter(({ qualityFlags }) =>
    qualityFlags.includes('csi-payload-truncated'),
  ).length;
  const fallbackFrameCount = frames.length - explicitFrames.length;
  const reasons: string[] = [];

  if (physical && explicitFrameRatio < 0.98) {
    reasons.push(
      `Endast ${(explicitFrameRatio * 100).toFixed(1)}% av fysiska frames har validerat SND1-ID.`,
    );
  }
  if (physical && soundingSessionNonces.length !== 1) {
    reasons.push(
      `Fysisk capture innehåller ${soundingSessionNonces.length} sounding-sessioner; exakt en krävs.`,
    );
  }
  if (physical && receiverDroppedRecordCount > 0) {
    reasons.push(`Mottagarnoder rapporterar ${receiverDroppedRecordCount} tappade CSI0-poster.`);
  }
  if (physical && truncatedFrameCount > 0) {
    reasons.push(`${truncatedFrameCount} CSI-frames har trunkerad råpayload.`);
  }
  if (
    physical &&
    (maximumMarkerDeltaMicroseconds === undefined || maximumMarkerDeltaMicroseconds > 2_000)
  ) {
    reasons.push(
      maximumMarkerDeltaMicroseconds === undefined
        ? 'SND1-till-CSI callbackdelta saknas.'
        : `SND1-till-CSI callbackdelta är ${maximumMarkerDeltaMicroseconds.toFixed(0)} µs.`,
    );
  }

  return {
    version: 'wifi-capture-provenance-v1',
    physical,
    frameCount: frames.length,
    explicitFrameRatio,
    soundingSessionNonces,
    maximumMarkerDeltaMicroseconds,
    receiverDroppedRecordCount,
    truncatedFrameCount,
    fallbackFrameCount,
    valid: reasons.length === 0,
    reasons,
  };
}

export function assertWifiCaptureProvenance(
  capture: Pick<WifiSensingCapture, 'frames'>,
): WifiCaptureProvenanceAssessment {
  const assessment = assessWifiCaptureProvenance(capture.frames);
  if (!assessment.valid) {
    throw new Error(`Wi-Fi capture provenance failed: ${assessment.reasons.join(' ')}`);
  }
  return assessment;
}
