import { StyleSheet, Text, View, type DimensionValue } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { SignalBars } from '@/components/SignalBars';
import { StatusPill } from '@/components/StatusPill';
import { colors, radius, spacing } from '@/constants/theme';
import type { RfPosition } from '@/domain/scanning';
import { useScanSession } from '@/hooks/useScanSession';
import { formatPercent } from '@/utils/format';

const positionLabels: Record<RfPosition, string> = {
  'left-sternal': 'Vänster om bröstbenet',
  apex: 'Hjärtspetsområdet',
  'right-reference': 'Höger referensposition',
  'upper-chest': 'Övre bröstområdet',
};

export default function ScanScreen() {
  const { progress, result, error, isRunning, start, reset } = useScanSession();
  const progressPercent = Math.round(progress.progress * 100);
  const progressWidth: DimensionValue = `${progressPercent}%`;

  return (
    <Screen
      title="Utvidgad skanning"
      subtitle="Klockdata synkroniseras med en simulerad kroppsnära RF-mätning">
      <Card>
        <View style={styles.phaseHeader}>
          <View style={styles.phaseCopy}>
            <Text style={styles.phaseTitle}>{progress.title}</Text>
            <Text style={styles.phaseInstruction}>{progress.instruction}</Text>
          </View>
          <Text style={styles.progressText}>{progressPercent}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: progressWidth }]} />
        </View>
        <SignalBars active={isRunning} />
        {progress.currentPosition ? (
          <View style={styles.positionBox}>
            <Text style={styles.positionLabel}>AKTUELL POSITION</Text>
            <Text style={styles.positionValue}>
              {positionLabels[progress.currentPosition]}
            </Text>
          </View>
        ) : null}
      </Card>

      {progress.phase === 'idle' ? (
        <Card muted>
          <Text style={styles.sectionTitle}>Före mätningen</Text>
          <Text style={styles.body}>1. Sitt bekvämt och håll kroppen stilla.</Text>
          <Text style={styles.body}>2. Kontrollera att klockan sitter nära huden.</Text>
          <Text style={styles.body}>3. Följ varje bröstposition utan att ändra trycket.</Text>
          <Text style={styles.body}>
            4. Avbryt inte medicinsk hjälp för att genomföra skanningen.
          </Text>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <Text style={styles.errorTitle}>Tekniskt fel</Text>
          <Text style={styles.body}>{error}</Text>
        </Card>
      ) : null}

      {result ? (
        <Card>
          <View style={styles.resultHeader}>
            <View style={styles.resultCopy}>
              <Text style={styles.sectionTitle}>{result.assessment.title}</Text>
              <Text style={styles.body}>{result.assessment.summary}</Text>
            </View>
            <StatusPill level={result.assessment.level} />
          </View>
          <View style={styles.resultMetrics}>
            <View style={styles.resultMetric}>
              <Text style={styles.metricLabel}>Indikationspoäng</Text>
              <Text style={styles.metricValue}>{result.assessment.score}/100</Text>
            </View>
            <View style={styles.resultMetric}>
              <Text style={styles.metricLabel}>Konfidens</Text>
              <Text style={styles.metricValue}>
                {formatPercent(result.assessment.confidence)}
              </Text>
            </View>
            <View style={styles.resultMetric}>
              <Text style={styles.metricLabel}>RF-positioner</Text>
              <Text style={styles.metricValue}>{result.rfObservations.length}</Text>
            </View>
          </View>
          {result.assessment.evidence.map((evidence) => (
            <View style={styles.evidenceRow} key={evidence.id}>
              <Text style={styles.evidenceLabel}>{evidence.label}</Text>
              <Text style={styles.evidenceValue}>{evidence.value}</Text>
            </View>
          ))}
          <Text style={styles.disclaimer}>{result.assessment.medicalDisclaimer}</Text>
        </Card>
      ) : null}

      {!result ? (
        <AppButton
          label={isRunning ? 'Skanning pågår' : 'Starta demoskanning'}
          onPress={start}
          disabled={isRunning}
        />
      ) : (
        <AppButton label="Ny skanning" onPress={reset} secondary />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  phaseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  phaseCopy: { flex: 1, gap: spacing.xs },
  phaseTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  phaseInstruction: { color: colors.inkMuted, fontSize: 13, lineHeight: 19 },
  progressText: { color: colors.primary, fontSize: 16, fontWeight: '800' },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  positionBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  positionLabel: {
    color: colors.inkMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  positionValue: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  body: { color: colors.inkMuted, fontSize: 13, lineHeight: 20 },
  errorTitle: { color: colors.urgent, fontSize: 17, fontWeight: '700' },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  resultCopy: { flex: 1, gap: spacing.xs },
  resultMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  resultMetric: { flex: 1, minWidth: 85 },
  metricLabel: { color: colors.inkMuted, fontSize: 11, marginBottom: spacing.xs },
  metricValue: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  evidenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  evidenceLabel: { color: colors.inkMuted, fontSize: 13 },
  evidenceValue: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'right',
  },
  disclaimer: {
    color: colors.urgent,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
});
