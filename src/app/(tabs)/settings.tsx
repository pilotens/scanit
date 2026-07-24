import { StyleSheet, Switch, Text, View } from 'react-native';

import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { colors, spacing } from '@/constants/theme';
import { useAppState } from '@/state/AppProvider';

export default function SettingsScreen() {
  const { researchMode, setResearchMode } = useAppState();

  return (
    <Screen title="Inställningar" subtitle="Säkerhetsgränser, data och forskningsfunktioner">
      <Card>
        <View style={styles.settingRow}>
          <View style={styles.settingCopy}>
            <Text style={styles.settingTitle}>Forskningsläge</Text>
            <Text style={styles.settingBody}>Visar tekniska signalvärden och markerar all data som experimentell.</Text>
          </View>
          <Switch
            accessibilityLabel="Forskningsläge"
            value={researchMode}
            onValueChange={setResearchMode}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={researchMode ? colors.primary : colors.white}
          />
        </View>
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Dataprinciper</Text>
        <Text style={styles.body}>Local-first bearbetning ska vara standard. Rå hälsodata ska krypteras och aldrig skickas till en extern språkmodell utan separat samtycke.</Text>
        <View style={styles.separator} />
        <Text style={styles.sectionTitle}>Modellstyrning</Text>
        <Text style={styles.body}>Signalmodeller, riskkalibrering och säkerhetsregler versionshanteras separat. LLM-komponenten får inte åsidosätta säkerhetsregler.</Text>
      </Card>

      <Card muted>
        <Text style={styles.sectionTitle}>Medicinsk begränsning</Text>
        <Text style={styles.body}>ScanIt är i detta skede en mjukvaruprototyp. Resultat får inte användas för att diagnostisera, utesluta eller behandla sjukdom.</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  settingCopy: { flex: 1, gap: spacing.xs },
  settingTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  settingBody: { color: colors.inkMuted, fontSize: 13, lineHeight: 19 },
  sectionTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  body: { color: colors.inkMuted, fontSize: 13, lineHeight: 20 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
});
