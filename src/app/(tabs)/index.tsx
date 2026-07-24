import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { MetricCard } from '@/components/MetricCard';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { SignalBars } from '@/components/SignalBars';
import { StatusPill } from '@/components/StatusPill';
import { colors, spacing } from '@/constants/theme';
import { useAppState } from '@/state/AppProvider';
import { formatDateTime } from '@/utils/format';

const measurement = (
  value: number | null | undefined,
  suffix = '',
  decimals = 0,
) => (value === null || value === undefined ? '–' : `${value.toFixed(decimals)}${suffix}`);

export default function DashboardScreen() {
  const { latestVitals, baseline, sessions, sensors, healthKitImport } = useAppState();
  const latestAssessment = sessions[0]?.assessment;
  const connectedSensors = sensors.filter((sensor) => sensor.status === 'connected').length;
  const hrvValue = latestVitals.hrvSdnnMs ?? latestVitals.hrvRmssdMs;
  const hrvMethod = latestVitals.hrvSdnnMs !== null && latestVitals.hrvSdnnMs !== undefined
    ? 'SDNN'
    : 'RMSSD';
  const sourceLabel = latestVitals.source === 'healthkit' ? 'Apple Health' : 'Simulator';

  return (
    <Screen
      title="ScanIt"
      subtitle="Kontinuerlig klockmätning med kompletterande RF-skanning">
      <Card style={styles.hero}>
        <View style={styles.heroHeader}>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>AKTUELL INDIKATION</Text>
            <Text style={styles.heroTitle}>{latestAssessment?.title ?? 'Ingen bedömning ännu'}</Text>
          </View>
          <StatusPill level={latestAssessment?.level ?? 'normal'} />
        </View>
        <SignalBars />
        <Text style={styles.heroBody}>
          {latestAssessment?.summary ?? 'Genomför en skanning för att skapa en första baslinje.'}
        </Text>
        <AppButton label="Starta utvidgad skanning" onPress={() => router.push('/scan')} />
      </Card>

      <SectionHeader
        title={`Klockdata · ${sourceLabel}`}
        detail={`Uppdaterad ${formatDateTime(latestVitals.timestamp)}`}
      />
      <View style={styles.metricsRow}>
        <MetricCard
          label="Puls"
          value={measurement(latestVitals.heartRateBpm)}
          detail={`Baslinje ${baseline.restingHeartRateBpm} bpm`}
        />
        <MetricCard
          label="SpO₂"
          value={measurement(latestVitals.oxygenSaturationPercent, '%', 1)}
          detail={`Baslinje ${baseline.oxygenSaturationPercent}%`}
        />
      </View>
      <View style={styles.metricsRow}>
        <MetricCard
          label={`HRV · ${hrvMethod}`}
          value={measurement(hrvValue, ' ms', 1)}
          detail={
            hrvMethod === 'RMSSD'
              ? `RMSSD-baslinje ${baseline.hrvRmssdMs} ms`
              : baseline.hrvSdnnMs
                ? `SDNN-baslinje ${baseline.hrvSdnnMs} ms`
                : 'SDNN-baslinje byggs senare'
          }
        />
        <MetricCard
          label="Handledstemperatur"
          value={measurement(latestVitals.skinTemperatureCelsius, '°', 1)}
          detail={
            latestVitals.source === 'healthkit'
              ? 'Senaste tillgängliga sömnmätning'
              : `Baslinje ${baseline.skinTemperatureCelsius.toFixed(1)}°`
          }
        />
      </View>

      <SectionHeader title="Systemstatus" />
      <Card>
        <View style={styles.statusRow}>
          <View style={styles.statusCopy}>
            <Text style={styles.cardTitle}>{connectedSensors} av {sensors.length} moduler anslutna</Text>
            <Text style={styles.cardBody}>
              {healthKitImport
                ? `${healthKitImport.electrocardiograms.length} EKG-sammanfattningar finns lokalt från Apple Health.`
                : 'Klocka, telefon och RF-scanner arbetar som separata datakällor.'}
            </Text>
          </View>
          <StatusPill
            level="normal"
            label={latestVitals.source === 'healthkit' ? 'HealthKit' : 'Demo'}
          />
        </View>
      </Card>

      <Card muted>
        <Text style={styles.warningTitle}>Forskningsprototyp</Text>
        <Text style={styles.warningBody}>
          {latestVitals.source === 'healthkit'
            ? 'Klockvärdena är verkliga importerade sammanfattningar, men RF-modulen och riskmodellen är fortfarande simulerade. Appen diagnostiserar eller utesluter inte sjukdom.'
            : 'Klock- och RF-värden är simulerade. Appen diagnostiserar eller utesluter inte hjärtinfarkt och får inte försena kontakt med vården.'}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: '#E8F5F1' },
  heroHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  heroCopy: { flex: 1, gap: spacing.xs },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  heroTitle: { color: colors.ink, fontSize: 21, fontWeight: '700', lineHeight: 27 },
  heroBody: { color: colors.inkMuted, fontSize: 14, lineHeight: 21 },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  statusCopy: { flex: 1 },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  cardBody: { color: colors.inkMuted, fontSize: 13, lineHeight: 19, marginTop: spacing.xs },
  warningTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  warningBody: { color: colors.inkMuted, fontSize: 13, lineHeight: 19 },
});
