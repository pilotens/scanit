import type {
  TomographyAntenna,
  TomographyGeometry,
  TomographyPoint2D,
} from '@/domain/tomography';

export const tomographyDistance = (
  left: TomographyPoint2D,
  right: TomographyPoint2D,
) => Math.hypot(left.xMeters - right.xMeters, left.yMeters - right.yMeters);

export function createCircularTomographyGeometry(input?: {
  antennaCount?: number;
  radiusMeters?: number;
  fieldOfViewMeters?: number;
  geometryUncertaintyMillimeters?: number;
}): TomographyGeometry {
  const antennaCount = Math.max(4, Math.round(input?.antennaCount ?? 16));
  const radiusMeters = input?.radiusMeters ?? 0.28;
  const fieldOfViewMeters = input?.fieldOfViewMeters ?? 0.34;
  const antennas: TomographyAntenna[] = Array.from(
    { length: antennaCount },
    (_, index) => {
      const angle = (2 * Math.PI * index) / antennaCount;
      return {
        id: `ant-${String(index).padStart(2, '0')}`,
        index,
        xMeters: radiusMeters * Math.cos(angle),
        yMeters: radiusMeters * Math.sin(angle),
        azimuthRadians: angle + Math.PI,
        enabled: true,
      };
    },
  );

  return {
    schemaVersion: 1,
    id: `ring-${antennaCount}-${Math.round(radiusMeters * 1000)}mm`,
    coordinateSystem: 'scanner-local-cartesian',
    antennas,
    fieldOfView: {
      center: { xMeters: 0, yMeters: 0 },
      widthMeters: fieldOfViewMeters,
      heightMeters: fieldOfViewMeters,
    },
    nominalArrayRadiusMeters: radiusMeters,
    geometryUncertaintyMillimeters:
      input?.geometryUncertaintyMillimeters ?? 1,
  };
}

export function activeTomographyAntennas(geometry: TomographyGeometry) {
  return geometry.antennas.filter(({ enabled }) => enabled);
}

export function tomographyPairKey(
  txAntennaId: string,
  rxAntennaId: string,
  frequencyHz: number,
) {
  return `${txAntennaId}|${rxAntennaId}|${Math.round(frequencyHz)}`;
}
