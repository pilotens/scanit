import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { StatusPill } from '@/components/StatusPill';
import { colors, radius, spacing } from '@/constants/theme';
import type { WifiSensingAnalysis } from '@/domain/wifiSensing';
import { runWifiSensingLab } from '@/services/scanner/wifi/labRunner';

const rate = (value: number | undefined) =>
  value === undefined ? 'ej löst' : `${value.toFixed(1)} /min`;

const Trace = ({ values }: { values: number[] }) => (
  <View style={styles.trace}>
    {values.map((value, index) => (
      <View
        key={`${index}-${value}`}
        style={[
          styles.traceBar,
          {
            height: Math.max(2, Math.round((Math.abs(value) * 0.8 + 0.2) * 48)),
            opacity: 0.4 + Math.min(0.6, Math.abs(value) * 0.6),
          },
        ]}
      />
    ))}
  </View>
);

export function WifiSensingPanel() {
  const [analysis, setAnalysis] = useState<WifiSensingAnalysis | null>(null);
  const [calibrationScore, setCalibrationScore] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await runWifiSensingLab({ label: 'Scanner Wi-Fi CSI diagnostic' });
      setAnalysis(result.analysis);
      setCalibrationScore(result.calibrationQualityScore);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Wi-Fi CSI-diagnostiken misslyckades.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>WI-FI CSI · VITALSPÅR</Text>
          <Text style={styles.title}>Flerlänks-sounding och CSI-kvot</Text>
        </View>
        <StatusPill
          level={analysis?.qualityGate.verdict === 'approved' ? 'normal' : 'observe'}
          label={analysis ? analysis.qualityGate.verdict : 'Ej körd'}
        />
      </View>
      <Text style={styles.body}>
        Diagnostiken använder tre synkroniserade mottagarlänkar, 56 OFDM-subbärare, stilla kalibrering och WCS1 record/replay. Resultatet är kanalrörelse – inte en anatomibild.
      </Text>
      <AppButton
        label={running ? 'Kör Wi-Fi CSI-diagnostik…' : 'Kör Wi-Fi CSI-diagnostik'}
        disabled={running}
        onPress={() => void run()}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {analysis ? (
        <View style={styles.results}>
          <View style={styles.metricGrid}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Kvalitet</Text>
              <Text style={styles.metricValue}>{analysis.qualityGate.score}%</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Kalibrering</Text>
              <Text style={styles.metricValue}>{calibrationScore ?? 0}%</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Andningsband</Text>
              <Text style={styles.metricValue}>{rate(analysis.respiratoryRateBpm)}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Mekaniskt band</Text>
              <Text style={styles.metricValue}>{rate(analysis.mechanicalRateBpm)}</Text>
            </View>
          </View>
          <Text style={styles.traceLabel}>KALIBRERAD RELATIV CSI-FAS</Text>
          <Trace values={analysis.relativePhaseTrace} />
          <Text style={styles.traceLabel}>SEPARERAT MEKANISKT FREKVENSBAND</Text>
          <Trace values={analysis.mechanicalTrace} />
          <Text style={styles.meta}>
            {analysis.soundingCount} parade soundings · {analysis.receiverLinkCount} länkar · {analysis.selectedSubcarrierCount} subbärare · multipathstabilitet {(analysis.multipathStability * 100).toFixed(0)}%
          </Text>
          {analysis.qualityGate.reasons.map((reason) => (
            <Text key={reason} style={styles.warning}>• {reason}</Text>
          ))}
          <Text style={styles.boundary}>
            Wi-Fi CSI kan i detta spår endast stödja RF-periodicitet. Anatomi, blodflöde, kranskärl, förträngning, ischemi och infarkt är fortsatt blockerade slutsatser.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#EEF5F9' },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  copy: { flex: 1, gap: spacing.xs },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  body: { color: colors.inkMuted, fontSize: 13, lineHeight: 20 },
  error: { color: colors.urgent, fontSize: 12 },
  results: { gap: spacing.sm },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  metricLabel: { color: colors.inkMuted, fontSize: 10, fontWeight: '700' },
  metricValue: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  traceLabel: { color: colors.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  trace: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xs,
  },
  traceBar: { flex: 1, maxWidth: 4, borderRadius: 2, backgroundColor: colors.primary },
  meta: { color: colors.inkMuted, fontSize: 11, lineHeight: 16 },
  warning: { color: colors.elevated, fontSize: 11, lineHeight: 16 },
  boundary: {
    color: colors.elevated,
    fontSize: 11,
    lineHeight: 17,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
});