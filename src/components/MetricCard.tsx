import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { colors, spacing } from '@/constants/theme';

type MetricCardProps = {
  label: string;
  value: string;
  detail: string;
};

export function MetricCard({ label, value, detail }: MetricCardProps) {
  return (
    <Card style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueRow}>
        <Text style={styles.value}>{value}</Text>
      </View>
      <Text style={styles.detail}>{detail}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 150 },
  label: { color: colors.inkMuted, fontSize: 13, fontWeight: '600' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  value: { color: colors.ink, fontSize: 27, fontWeight: '700' },
  detail: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
});
