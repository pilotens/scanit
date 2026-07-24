import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import type { RiskLevel } from '@/domain/health';

type StatusPillProps = {
  level: RiskLevel;
  label?: string;
};

type StatusPalette = {
  backgroundColor: string;
  foregroundColor: string;
};

const labels: Record<RiskLevel, string> = {
  normal: 'Stabil',
  observe: 'Observera',
  elevated: 'Förhöjd',
  urgent: 'Akut signal',
};

const palettes: Record<RiskLevel, StatusPalette> = {
  normal: { backgroundColor: '#E2F2ED', foregroundColor: colors.normal },
  observe: { backgroundColor: '#F5EFD9', foregroundColor: colors.observe },
  elevated: { backgroundColor: '#F8E7DE', foregroundColor: colors.elevated },
  urgent: { backgroundColor: '#F7E1E3', foregroundColor: colors.urgent },
};

export function StatusPill({ level, label }: StatusPillProps) {
  const palette = palettes[level];

  return (
    <View style={[styles.pill, { backgroundColor: palette.backgroundColor }]}>
      <View style={[styles.dot, { backgroundColor: palette.foregroundColor }]} />
      <Text style={[styles.text, { color: palette.foregroundColor }]}>
        {label ?? labels[level]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 13, fontWeight: '700' },
});
