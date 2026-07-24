import { Alert, StyleSheet, Switch, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { colors, spacing } from '@/constants/theme';
import { useAppState } from '@/state/AppProvider';

export default function SettingsScreen() {
  const {
    researchMode,
    setResearchMode,
    storage,
    persistenceStatus,
    persistenceError,
    isHydrated,
    clearLocalData,
  } = useAppState();

  const confirmClear = () => {
    Alert.alert(
      'Rensa lokal data?',
      'Alla lokalt sparade skanningar och inställningar tas bort från den här enheten.',
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Rensa',
          style: 'destructive',
          onPress: () => {
            void clearLocalData();
          },
        },
      ],
    );
  };

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
        <Text style={styles.sectionTitle}>Lokal lagring</Text>
        <Text style={styles.storageLabel}>{storage.label}</Text>
        <Text style={styles.body}>{storage.description}</Text>
        <View style={styles.storageFacts}>
          <Text style={styles.fact}>Beständig: {storage.isPersistent ? 'Ja' : 'Nej'}</Text>
          <Text style={styles.fact}>Krypterad: {storage.isEncrypted ? 'Ja' : 'Nej'}</Text>
          <Text style={styles.fact}>
            Status: {persistenceStatus === 'loading' ? 'Läser in' : persistenceStatus === 'ready' ? 'Redo' : 'Fel'}
          </Text>
        </View>
        {persistenceError ? <Text style={styles.error}>{persistenceError}</Text> : null}
        <AppButton label="Rensa lokal historik" onPress={confirmClear} secondary disabled={!isHydrated} />
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Dataprinciper</Text>
        <Text style={styles.body}>Local-first bearbetning ska vara standard. Rå hälsodata krypteras på native-enheter och skickas aldrig till en extern språkmodell utan separat samtycke.</Text>
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
  storageLabel: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  storageFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fact: { color: colors.inkMuted, fontSize: 12, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  body: { color: colors.inkMuted, fontSize: 13, lineHeight: 20 },
  error: { color: colors.urgent, fontSize: 12, lineHeight: 18 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
});
