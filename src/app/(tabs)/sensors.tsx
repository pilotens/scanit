import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { colors, spacing } from '@/constants/theme';
import type { ConnectionStatus } from '@/domain/health';
import { useAppState } from '@/state/AppProvider';

const statusLabel: Record<ConnectionStatus, string> = {
  connected: 'Ansluten',
  available: 'Tillgänglig',
  disconnected: 'Frånkopplad',
};

export default function SensorsScreen() {
  const { sensors } = useAppState();

  return (
    <Screen title="Sensorer" subtitle="Modulär anslutning för klocka, radio och telefon">
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
  meta: { color: colors.inkMuted, fontSize: 12 },
  demo: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  noteTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  noteBody: { color: colors.inkMuted, fontSize: 13, lineHeight: 19 },
});
