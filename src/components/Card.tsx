import type { PropsWithChildren } from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

type CardProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  muted?: boolean;
}>;

export function Card({ children, style, muted = false }: CardProps) {
  return <View style={[styles.card, muted && styles.muted, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  muted: { backgroundColor: colors.surfaceMuted },
});
