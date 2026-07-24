import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

type AppButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
};

export function AppButton({ label, onPress, disabled = false, secondary = false }: AppButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }: { pressed: boolean }) => [
        styles.button,
        secondary ? styles.secondary : styles.primary,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}>
      <Text style={[styles.label, secondary && styles.secondaryLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  label: { color: colors.white, fontSize: 16, fontWeight: '700' },
  secondaryLabel: { color: colors.ink },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
});
