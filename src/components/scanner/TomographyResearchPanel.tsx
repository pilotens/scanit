import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { StatusPill } from '@/components/StatusPill';
import { colors, radius, spacing } from '@/constants/theme';
import { runTomographyBenchDiagnostic } from '@/services/scanner/tomography/benchDiagnostic';

type DiagnosticResult = ReturnType<typeof runTomographyBenchDiagnostic>;

export function TomographyResearchPanel() {
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const heatmap = useMemo(() => {
    if (!result) return [];
    const { normalizedContrast, grid } = result.reconstruction;
    const stride = Math.max(1, Math.floor(grid.width / 15));
    const cells: number[] = [];
    for (let y = 0; y < grid.height; y += stride) {
      for (let x = 0; x < grid.width; x += stride) {
        cells.push(normalizedContrast[y * grid.width + x] ?? 0);
      }
    }
    return cells;
  }, [result]);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await Promise.resolve();
      setResult(runTomographyBenchDiagnostic());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Tomografidiagnostiken kunde inte köras.',
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Card style={styles.hero}>
        <View style={styles.header}>
          <View style={styles.copy}>
            <Text style={styles.eyebrow}>FORSKNINGSSPÅR B</Text>
            <Text style={styles.title}>Multistatisk mikrovågstomografi</Text>
          </View>
          <StatusPill level="observe" label="Experimentell" />
        </View>
        <Text style={styles.body}>
          Detta spår kräver en koherent antennarray runt bröstkorgen. Det använder inte telefonens vanliga Wi-Fi-radio och är helt separerat från vitalspårets rörelseanalys.
        </Text>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Phantomdiagnostik</Text>
        <Text style={styles.body}>
          Kör hela kedjan med 12 antennpositioner, 132 TX/RX-par och ett koherent 2,5–6,5 GHz-svep mot ett känt simulerat spridningsmål.
        </Text>
        <AppButton
          label={running ? 'Rekonstruerar…' : 'Kör tomografi-phantom'}
          onPress={() => void run()}
          disabled={running}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>

      {result ? (
        <Card>
          <View style={styles.header}>
            <View style={styles.copy}>
              <Text style={styles.sectionTitle}>Relativ kontrastrekonstruktion</Text>
              <Text style={styles.meta}>
                {result.reconstruction.version} · {result.reconstruction.differentialMeasurementCount} differentialmätningar
              </Text>
            </View>
            <StatusPill
              level={result.passed ? 'normal' : 'elevated'}
              label={result.passed ? 'Tekniskt godkänd' : 'Ej godkänd'}
            />
          </View>
          <View style={styles.metrics}>
            <Metric
              label="Kvalitet"
              value={`${result.reconstruction.qualityGate.score}/100`}
            />
            <Metric
              label="Lokaliseringsfel"
              value={
                result.localizationErrorMeters === undefined
                  ? '–'
                  : `${(result.localizationErrorMeters * 1000).toFixed(0)} mm`
              }
            />
            <Metric
              label="Teoretisk rangeupplösning"
              value={`${(result.reconstruction.estimatedRangeResolutionMeters * 1000).toFixed(0)} mm`}
            />
          </View>
          <Text style={styles.label}>RELATIV SPRIDNINGSKONTRAST</Text>
          <View style={styles.heatmap}>
            {heatmap.map((value, index) => (
              <View
                key={`${index}-${value}`}
                style={[
                  styles.heatCell,
                  { opacity: Math.max(0.08, Math.min(1, value)) },
                ]}
              />
            ))}
          </View>
          {result.reconstruction.claims.map((claim) => (
            <View key={claim.id} style={styles.claim}>
              <Text style={styles.claimTitle}>
                {claim.id}: {claim.state}
              </Text>
              <Text style={styles.meta}>{claim.explanation}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: '#F4F0FA' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  copy: { flex: 1, gap: spacing.xs },
  eyebrow: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  title: { color: colors.ink, fontSize: 20, fontWeight: '700', lineHeight: 26 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  body: { color: colors.inkMuted, fontSize: 13, lineHeight: 20 },
  meta: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  error: { color: colors.urgent, fontSize: 12, lineHeight: 18 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: {
    flex: 1,
    minWidth: 95,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  metricLabel: { color: colors.inkMuted, fontSize: 10, marginBottom: spacing.xs },
  metricValue: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  label: { color: colors.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  heatmap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 1,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
    borderRadius: radius.md,
  },
  heatCell: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  claim: {
    gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  claimTitle: { color: colors.ink, fontSize: 12, fontWeight: '700' },
});
