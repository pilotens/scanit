import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { StatusPill } from '@/components/StatusPill';
import { colors, radius, spacing } from '@/constants/theme';
import type {
  ScannerComparisonResult,
  ScannerLabProgress,
  ScannerRecordingManifest,
  ScannerReplayResult,
} from '@/domain/scannerLab';
import type { RfPosition } from '@/domain/scanning';
import { ScannerLabRunner } from '@/services/scanner/lab/scannerLabRunner';
import { scannerRecordingRepository } from '@/services/scanner/recording/recordingRepository';
import { compareScannerReplays, replayScannerRecording } from '@/services/scanner/replay/replayEngine';

const positions: Array<{ value: RfPosition; label: string }> = [
  { value: 'left-sternal', label: 'Vänster sternum' },
  { value: 'apex', label: 'Apex' },
  { value: 'right-reference', label: 'Höger referens' },
  { value: 'upper-chest', label: 'Övre bröst' },
];
const durations = [5, 10, 30] as const;

const classificationLabel: Record<ScannerComparisonResult['classification'], string> = {
  stable: 'Stabil',
  changed: 'Förändrad',
  'significant-change': 'Tydlig skillnad',
};

export function ScannerLabPanel() {
  const [position, setPosition] = useState<RfPosition>('apex');
  const [durationSeconds, setDurationSeconds] = useState<(typeof durations)[number]>(10);
  const [label, setLabel] = useState('');
  const [progress, setProgress] = useState<ScannerLabProgress | null>(null);
  const [recordings, setRecordings] = useState<ScannerRecordingManifest[]>([]);
  const [replay, setReplay] = useState<ScannerReplayResult | null>(null);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ScannerComparisonResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshRecordings = async () => setRecordings(await scannerRecordingRepository.list());
  useEffect(() => {
    void refreshRecordings().catch((caught) =>
      setError(caught instanceof Error ? caught.message : 'Kunde inte läsa scannerinspelningar.'),
    );
  }, []);

  const capture = async () => {
    setBusy(true);
    setError(null);
    setComparison(null);
    try {
      const result = await new ScannerLabRunner().capture(
        {
          label,
          position,
          durationSeconds,
          targetFrameRateHz: 20,
          calibrationFrames: 12,
          maxFrames: 600,
          tags: ['scanner-lab'],
          notes: ['Skapad i Scanner Lab. Ingen anatomisk eller medicinsk tolkning.'],
        },
        setProgress,
      );
      setReplay(result.replay);
      setLabel('');
      await refreshRecordings();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Scanner Lab kunde inte slutföra mätningen.');
    } finally {
      setBusy(false);
    }
  };

  const replayRecording = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      setReplay(replayScannerRecording(await scannerRecordingRepository.load(id)));
      setComparison(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Replay misslyckades.');
    } finally {
      setBusy(false);
    }
  };

  const compareRecording = async (candidateId: string) => {
    if (!referenceId || referenceId === candidateId) {
      setReferenceId(candidateId);
      setComparison(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [reference, candidate] = await Promise.all([
        scannerRecordingRepository.load(referenceId),
        scannerRecordingRepository.load(candidateId),
      ]);
      setComparison(
        compareScannerReplays(
          replayScannerRecording(reference),
          replayScannerRecording(candidate),
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Jämförelsen misslyckades.');
    } finally {
      setBusy(false);
    }
  };

  const removeRecording = (recording: ScannerRecordingManifest) => {
    Alert.alert(
      'Radera scannerinspelning?',
      `${recording.label} och alla krypterade råframes tas bort från enheten.`,
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Radera',
          style: 'destructive',
          onPress: () => {
            void scannerRecordingRepository.remove(recording.id).then(async () => {
              if (referenceId === recording.id) setReferenceId(null);
              if (replay?.recordingId === recording.id) setReplay(null);
              await refreshRecordings();
            });
          },
        },
      ],
    );
  };

  const chartValues = useMemo(() => {
    const samples = replay?.samples.slice(-40) ?? [];
    const raw = samples.map((sample) =>
      Math.abs(sample.displacementMillimeters ?? sample.motionScore),
    );
    const maximum = Math.max(...raw, 0.0001);
    return raw.map((value) => value / maximum);
  }, [replay]);

  return (
    <>
      <Card style={styles.labHero}>
        <View style={styles.header}>
          <View style={styles.copy}>
            <Text style={styles.eyebrow}>SCANNER LAB</Text>
            <Text style={styles.title}>Spela in, återspela och jämför rå RF-data</Text>
          </View>
          <StatusPill level={busy ? 'observe' : 'normal'} label={busy ? 'Arbetar' : 'Redo'} />
        </View>
        <Text style={styles.body}>
          Varje session sparar originalpaketen. Nya signalalgoritmer kan därför testas mot samma mätning utan att scannern är ansluten.
        </Text>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Ny labbinspelning</Text>
        <Text style={styles.label}>POSITION</Text>
        <View style={styles.chips}>
          {positions.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setPosition(item.value)}
              style={[styles.chip, position === item.value && styles.chipSelected]}>
              <Text style={[styles.chipText, position === item.value && styles.chipTextSelected]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>MÄTLÄNGD</Text>
        <View style={styles.chips}>
          {durations.map((duration) => (
            <Pressable
              key={duration}
              onPress={() => setDurationSeconds(duration)}
              style={[styles.chip, durationSeconds === duration && styles.chipSelected]}>
              <Text style={[styles.chipText, durationSeconds === duration && styles.chipTextSelected]}>
                {duration} sek
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          accessibilityLabel="Inspelningsetikett"
          onChangeText={setLabel}
          placeholder="Etikett, exempelvis Apex vila dag 1"
          style={styles.input}
          value={label}
        />
        <AppButton label={busy ? 'Scanner Lab arbetar…' : 'Starta och spara råinspelning'} onPress={() => void capture()} disabled={busy} />
        {progress ? (
          <View style={styles.progressBox}>
            <Text style={styles.progressTitle}>{progress.message}</Text>
            <Text style={styles.meta}>
              {Math.round(progress.progress * 100)}% · {progress.framesCaptured}/{progress.targetFrames} frames
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(progress.progress * 100)}%` }]} />
            </View>
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>

      {replay ? (
        <Card>
          <View style={styles.header}>
            <View style={styles.copy}>
              <Text style={styles.sectionTitle}>Replay: {replay.manifest.label}</Text>
              <Text style={styles.meta}>{replay.processingVersion} · {replay.summary.processedFrameCount} analyserade frames</Text>
            </View>
            <StatusPill level={replay.summary.dominantSignalQuality === 'poor' ? 'elevated' : 'normal'} label={replay.summary.dominantSignalQuality} />
          </View>
          <View style={styles.metrics}>
            <Metric label="SNR" value={`${replay.summary.averageSignalToNoiseRatioDb.toFixed(1)} dB`} />
            <Metric label="Peakrörelse" value={`${replay.summary.peakDisplacementMillimeters.toFixed(3)} mm`} />
            <Metric label="Range" value={replay.summary.averageTargetRangeMeters === undefined ? '–' : `${(replay.summary.averageTargetRangeMeters * 100).toFixed(1)} cm`} />
          </View>
          <Text style={styles.label}>SENASTE MIKRORÖRELSEFRAMES</Text>
          <View style={styles.chart}>
            {chartValues.map((value, index) => (
              <View key={`${index}-${value}`} style={[styles.chartBar, { height: Math.max(3, value * 72) }]} />
            ))}
          </View>
          {replay.summary.qualityFlags.length ? (
            <Text style={styles.warning}>Kvalitetsflaggor: {replay.summary.qualityFlags.join(', ')}</Text>
          ) : null}
        </Card>
      ) : null}

      {comparison ? (
        <Card muted>
          <View style={styles.header}>
            <Text style={styles.sectionTitle}>Differensanalys</Text>
            <StatusPill
              level={comparison.classification === 'stable' ? 'normal' : comparison.classification === 'changed' ? 'observe' : 'elevated'}
              label={classificationLabel[comparison.classification]}
            />
          </View>
          <Text style={styles.body}>Profilslikhet: {(comparison.profileCosineSimilarity * 100).toFixed(1)}%</Text>
          <Text style={styles.body}>Rangeförskjutning: {comparison.averageRangeShiftMillimeters === undefined ? '–' : `${comparison.averageRangeShiftMillimeters.toFixed(1)} mm`}</Text>
          <Text style={styles.body}>Skillnad i peakrörelse: {comparison.peakDisplacementDifferenceMillimeters.toFixed(3)} mm</Text>
          <Text style={styles.body}>SNR-skillnad: {comparison.averageSnrDifferenceDb.toFixed(1)} dB</Text>
          {comparison.warnings.map((warning) => <Text key={warning} style={styles.warning}>{warning}</Text>)}
        </Card>
      ) : null}

      <Card>
        <View style={styles.header}>
          <View style={styles.copy}>
            <Text style={styles.sectionTitle}>Sparade råinspelningar</Text>
            <Text style={styles.meta}>{recordings.length} sessioner · krypterade och chunkade på native-enheter</Text>
          </View>
          {referenceId ? <StatusPill level="observe" label="Referens vald" /> : null}
        </View>
        {!recordings.length ? <Text style={styles.body}>Ingen labbinspelning är sparad ännu.</Text> : null}
        {recordings.map((recording) => (
          <View style={styles.recording} key={recording.id}>
            <View style={styles.header}>
              <View style={styles.copy}>
                <Text style={styles.recordingTitle}>{recording.label}</Text>
                <Text style={styles.meta}>
                  {recording.position} · {recording.frameCount} frames · {(recording.totalBytes / 1024).toFixed(0)} kB
                </Text>
                <Text style={styles.meta}>
                  CRC {recording.aggregateCrc32} · luckor {recording.sequenceGaps} · {recording.isSimulated ? 'emulator' : 'fysisk'}
                </Text>
              </View>
              <StatusPill level={recording.sequenceGaps ? 'observe' : 'normal'} label={recording.sequenceGaps ? 'Luckor' : 'Hel'} />
            </View>
            <AppButton label="Återspela" onPress={() => void replayRecording(recording.id)} secondary disabled={busy} />
            <AppButton
              label={referenceId === recording.id ? 'Vald som referens' : referenceId ? 'Jämför med referens' : 'Välj som referens'}
              onPress={() => void compareRecording(recording.id)}
              secondary
              disabled={busy || referenceId === recording.id}
            />
            <AppButton label="Radera inspelning" onPress={() => removeRecording(recording)} secondary disabled={busy} />
          </View>
        ))}
      </Card>
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
  labHero: { backgroundColor: '#EEF2FA' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  copy: { flex: 1, gap: spacing.xs },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: colors.ink, fontSize: 20, fontWeight: '700', lineHeight: 26 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  body: { color: colors.inkMuted, fontSize: 13, lineHeight: 20 },
  meta: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  label: { color: colors.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  chipTextSelected: { color: colors.white },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.ink, fontSize: 14, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  progressBox: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  progressTitle: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  progressTrack: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.border },
  progressFill: { height: 8, backgroundColor: colors.primary },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  metric: { flex: 1, minWidth: 90, backgroundColor: colors.surfaceMuted, padding: spacing.md, borderRadius: radius.md },
  metricLabel: { color: colors.inkMuted, fontSize: 10, marginBottom: spacing.xs },
  metricValue: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  chart: { height: 84, flexDirection: 'row', alignItems: 'flex-end', gap: 2, padding: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radius.md },
  chartBar: { flex: 1, borderRadius: 2, backgroundColor: colors.primary },
  warning: { color: colors.elevated, fontSize: 12, lineHeight: 18 },
  error: { color: colors.urgent, fontSize: 12, lineHeight: 18 },
  recording: { gap: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.md },
  recordingTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
});
