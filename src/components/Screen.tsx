import type { PropsWithChildren, ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';

type ScreenProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  right?: ReactNode;
  scroll?: boolean;
}>;

export function Screen({ title, subtitle, right, scroll = true, children }: ScreenProps) {
  const header = (
    <View style={styles.header}>
      <View style={styles.heading}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={styles.contentStatic}>
          {header}
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.lg },
  contentStatic: { flex: 1, padding: spacing.lg, gap: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  heading: { flex: 1, gap: spacing.xs },
  title: { color: colors.ink, fontSize: 30, fontWeight: '700', letterSpacing: -0.8 },
  subtitle: { color: colors.inkMuted, fontSize: 15, lineHeight: 21 },
});
