import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/theme';
import type { ReconstructionVolume, Voxel } from '@/domain/imaging';

type Props = {
  volume: ReconstructionVolume;
  width?: number;
  height?: number;
};

const score = (voxel: Voxel) =>
  (voxel.structuralIntensity ?? 0) * 0.65 +
  (voxel.dielectricContrast ?? 0) * 0.25 +
  Math.min(1, (voxel.motionAmplitude ?? 0) / 2) * 0.1;

export function VolumeSlice({ volume, width = 300, height = 210 }: Props) {
  if (!volume.voxels.length) return <View style={[styles.frame, { width, height }]} />;

  const xs = volume.voxels.map((v) => v.positionMm.x);
  const zs = volume.voxels.map((v) => v.positionMm.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const xSpan = Math.max(1, maxX - minX);
  const zSpan = Math.max(1, maxZ - minZ);
  const dot = Math.max(4, Math.min(10, width / Math.max(10, volume.dimensions.x)));

  return (
    <View style={[styles.frame, { width, height }]}>
      {volume.voxels.map((voxel, index) => {
        const intensity = score(voxel);
        if (intensity < 0.12) return null;
        return (
          <View
            key={index}
            style={[
              styles.voxel,
              {
                width: dot,
                height: dot,
                borderRadius: dot / 2,
                opacity: Math.max(0.18, Math.min(1, voxel.confidence * intensity + 0.15)),
                left: ((voxel.positionMm.x - minX) / xSpan) * (width - dot),
                top: ((voxel.positionMm.z - minZ) / zSpan) * (height - dot),
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'relative',
    overflow: 'hidden',
    alignSelf: 'center',
    backgroundColor: '#07110F',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  voxel: {
    position: 'absolute',
    backgroundColor: colors.accent,
  },
});
