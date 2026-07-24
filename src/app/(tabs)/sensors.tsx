import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { colors, spacing } from '@/constants/theme';
import type { ConnectionStatus } from '@/domain/health';
import type { HealthKitEcgSummary } from '@/domain/onboarding';
import { useAppState } from '@/state/AppProvider';
import { formatDateTime } from '@/utils/format';

const statusLabel: Record<ConnectionStatus, string> = {
  connected: 'Ansluten',
  available: 'Tillgänglig',
  disconnected: 'Frånkopplad',
};

const ecgClassificationLabel: Record<HealthKitEcgSummary['classification'], string> = {
  'sinus-rhythm': 'Sinusrytm',
  'atrial-fibrillation': 'Förmaksflimmer',
  'inconclusive-high-heart-rate': 'Ej avgörbart · hög puls',
  'inconclusive-low-heart-rate': 'Ej avgörbart · låg puls',
  'inconclusive-poor-reading': 'Ej avgörbart · svag mätning',
  'inconclusive-other': 'Ej avgörbart',
  unrecognized: 'Okänd klassificering',
  'not-set': 'Ingen klassificering',
};

export default function SensorsScreen() {
  const {
    sensors,
    healthKitSupported,
    healthKitStatus,
    healthKitImport,
    healthKitError,
    connectAndImportHealthKit,
  } = useAppState();
  const healthKitBusy = healthKitStatus === 'authorizing' || healthKitStatus === 'importing';
  const latestEcg = healthKitImport?.electrocardiograms[0];

  return (
    <Screen title="Sensorer" subtitle="Modulär anslutning för klocka, radio och telefon">
      <Card>
        <View style={styles.header}>
          <View style={styles.heading}>
            <Text style={styles.title}>Apple Health / Apple Watch</Text>
            <Text style={styles.kind}>HEALTHKIT · LÄSBEHÖRIGHET</Text>
          </View>
          <View style={styles.status}>
            <View style={[styles.dot, healthKitStatus === 'ready' && styles.dotConnected]} />
            <Text style={styles.statusText}>
              {healthKitStatus === 'ready'
                ? 'Importerad'
                : healthKitBusy
                  ? 'Läser in'
                  : healthKitSupported
                    ? 'Tillgänglig'
                    : 'Ej tillgänglig'}
            </Text>
          </View>
        </View>
        <View style={styles.capabilities}>
          {['Puls', 'SDNN-HRV', 'SpO₂', 'Handledstemperatur', 'EKG-sammanfattning'].map(
            (capability) => (
              <View style={styles.capability} key={capability}>
                <Text style={styles.capabilityText}>{capability}</Text>
              </View>
            ),
          )}
        </View>
        {healthKitImport ? (
          <View style={styles.importFacts}>
            <Text style={styles.meta}>
              Senast importerad {formatDateTime(healthKitImport.importedAt)}
            </Text>
            <Text style={styles.meta}>
              {healthKitImport.electrocardiograms.length} EKG-poster
            </Text>
          </View>
        ) : null}
        {latestEcg ? (
          <View style={styles.ecgBox}>
            <Text style={styles.ecgTitle}>Senaste EKG</Text>
            <Text style={styles.ecgValue}>
              {ecgClassificationLabel[latestEcg.classification]}
            </Text>
            <Text style={styles.meta}>{formatDateTime(latestEcg.endDate)}</Text>
          </View>
        ) : null}
        {healthKitError ? <Text style={styles.error}>{healthKitError}</Text> : null}
        <AppButton
          label={
            healthKitBusy
              ? 'Apple Health läses in'
              : healthKitImport
                ? 'Uppdatera Apple Health'
                : 'Anslut Apple Health'
          }
          onPress={() => void connectAndImportHealthKit()}
          disabled={!healthKitSupported || healthKitBusy}
          secondary={Boolean(healthKitImport)}
        />
        <Text style={styles.privacyNote}>
          ScanIt begär endast läsåtkomst. Ett saknat värde kan bero på att mätningen inte finns eller att läsåtkomsten inte gavs.
        </Text>
      </Card>

      {sensors.map((sensor) => (
        <Card key={sensor.id}>
          <View style={styles.header}>
            <View style={styles.heading}>
              <Text style={styles.title}>{sensor.name}</Text>
              <Text style={styles.kind}>{sensor.kind.toUpperCase()}</Text>
            </View>
            <View style={styles.status}>
              <View style={[styles.dot, sensor.status === 'connected' && styles.dotConnected]} />
              <Text style={styles.statusText}>{statusLabel[sensor.status]}</Text>
            </View>
          </View>
          <View style={styles.capabilities}>
            {sensor.capabilities.map((capability) => (
              <View style={styles.capability} key={capability}>
                <Text style={styles.capabilityText}>{capability}</Text>
              </View>
            ))}
          </View>
          <View style={styles.footer}>
            <Text style={styles.meta}>{sensor.primary ? 'Primär datakälla' : 'Kompletterande datakälla'}</Text>
            {sensor.batteryPercent !== undefined ? (
              <Text style={styles.meta}>{sensor.batteryPercent}% batteri</Text>
            ) : null}
          </View>
          {sensor.simulated ? <Text style={styles.demo}>Simulatoradapter aktiv</Text> : null}
        </Card>
      ))}

      <Card muted>
        <Text style={styles.noteTitle}>Radioabstraktion</Text>
        <Text style={styles.noteBody}>
          Appen använder ett gemensamt sensorgränssnitt. Wi-Fi CSI, Bluetooth Channel Sounding, UWB och 60 GHz kan därför implementeras som separata adaptrar utan att ändra skanningsflödet.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  heading: { flex: 1, gap: spacing.xs },
  title: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  kind: { color: colors.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotConnected: { backgroundColor: colors.normal },
  statusText: { color: colors.inkMuted, fontSize: 12, fontWeight: '600' },
  capabilities: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  capability: { backgroundColor: colors.surfaceMuted, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  capabilityText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  importFacts: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
  meta: { color: colors.inkMuted, fontSize: 12 },
  demo: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  ecgBox: { backgroundColor: colors.surfaceMuted, padding: spacing.md, gap: spacing.xs },
  ecgTitle: { color: colors.inkMuted, fontSize: 11, fontWeight: '700' },
  ecgValue: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  error: { color: colors.urgent, fontSize: 12, lineHeight: 18 },
  privacyNote: { color: colors.inkMuted, fontSize: 11, lineHeight: 17 },
  noteTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  noteBody: { color: colors.inkMuted, fontSize: 13, lineHeight: 19 },
});
