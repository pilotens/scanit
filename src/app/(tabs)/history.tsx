import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { StatusPill } from '@/components/StatusPill';
import { colors, spacing } from '@/constants/theme';
import { useAppState } from '@/state/AppProvider';
import { formatDateTime, formatPercent } from '@/utils/format';

export default function HistoryScreen() {
  const { sessions } = useAppState();

  return (
    <Screen title="Historik" subtitle="Tidigare skanningar och förändringar från baslinjen">
      {sessions.map((session) => (
        <Card key={session.id}>
          <View style={styles.header}>
            <View style={styles.heading}>
              <Text style={styles.title}>{session.assessment.title}</Text>
              <Text style={styles.date}>{formatDateTime(session.completedAt)}</Text>
            </View>
            <StatusPill level={session.assessment.level} />
          </View>
          <Text style={styles.summary}>{session.assessment.summary}</Text>
          <View style={styles.metrics}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Indikationspoäng</Text>
              <Text style={styles.metricValue}>{session.assessment.score}/100</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Konfidens</Text>
              <Text style={styles.metricValue}>{formatPercent(session.assessment.confidence)}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>RF-positioner</Text>
              <Text style={styles.metricValue}>{session.rfObservations.length}</Text>
            </View>
          </View>
          {session.isSimulated ? <Text style={styles.demo}>Simulerad mätning</Text> : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  heading: { flex: 1, gap: spacing.xs },
  title: { color: colors.ink, fontSize: 17, fontWeight: '700', lineHeight: 23 },
  date: { color: colors.inkMuted, fontSize: 12 },
  summary: { color: colors.inkMuted, fontSize: 14, lineHeight: 20 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  metric: { flex: 1, minWidth: 90 },
  metricLabel: { color: colors.inkMuted, fontSize: 11, marginBottom: spacing.xs },
  metricValue: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  demo: { color: colors.primary, fontSize: 12, fontWeight: '700' },
});
