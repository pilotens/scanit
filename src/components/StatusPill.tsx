import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import type { RiskLevel } from '@/domain/health';

type StatusPillProps = {
  level: RiskLevel;
  label?: string;
};

const labels: Record<RiskLevel, string> = {
  normal: 'Stabil',
  observe: 'Observera',
  elevated: 'Förhöjd',
  urgent: 'Akut signal',
};

export function StatusPill({ level, label }: StatusPillProps) {
  return (
    <View style={[styles.pill, styles[level]]}>
      <View style={[styles.dot, styles[`${level}Dot`]]} />
      <Text style={[styles.text, styles[`${level}Text`]]}>{label ?? labels[level]}</Text>
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
  normal: { backgroundColor: '#E2F2ED' },
  observe: { backgroundColor: '#F5EFD9' },
  elevated: { backgroundColor: '#F8E7DE' },
  urgent: { backgroundColor: '#F7E1E3' },
  normalDot: { backgroundColor: colors.normal },
  observeDot: { backgroundColor: colors.observe },
  elevatedDot: { backgroundColor: colors.elevated },
  urgentDot: { backgroundColor: colors.urgent },
  normalText: { color: colors.normal },
  observeText: { color: colors.observe },
  elevatedText: { color: colors.elevated },
  urgentText: { color: colors.urgent },
});
