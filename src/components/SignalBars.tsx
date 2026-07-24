import { StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

type SignalBarsProps = {
  active?: boolean;
};

const heights = [12, 20, 34, 18, 28, 42, 24, 14, 38, 22, 30, 16, 26, 40, 19, 32];

export function SignalBars({ active = true }: SignalBarsProps) {
  return (
    <View accessibilityLabel="Simulerad signalvisualisering" style={styles.container}>
      {heights.map((height, index) => (
        <View
          key={`${height}-${index}`}
          style={[
            styles.bar,
            { height, opacity: active ? 0.45 + (index % 4) * 0.15 : 0.22 },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  bar: {
    flex: 1,
    maxWidth: 8,
    minWidth: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
});
