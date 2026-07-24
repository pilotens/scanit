import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { StatusPill } from '@/components/StatusPill';
import { colors, radius, spacing } from '@/constants/theme';
import type { ScannerCoreDiagnostic } from '@/domain/radio';
import { scannerHardwareProfiles } from '@/services/scanner/hardwareProfiles';
import { runScannerCoreDiagnostic } from '@/services/scanner/selfTest';

export default function ScannerScreen() {
  const [diagnostic, setDiagnostic] = useState<ScannerCoreDiagnostic | null>(null);

  return (
    <Screen title="Scanner" subtitle="Rå RF-data, kalibrering och signalbehandling">
      <Card style={styles.hero}>
        <View style={styles.header}>
          <View style={styles.copy}>
            <Text style={styles.eyebrow}>PRIMÄRT POC-SPÅR</Text>
            <Text style={styles.title}>60 GHz mekanik + UWB vävnadsrespons</Text>
          </View>
          <StatusPill level="observe" label="Forskningsläge" />
        </View>
        <Text style={styles.body}>
          Scanner-core bevarar komplex IQ-data och separerar hårdvara, transport, kalibrering och analys. Visualiseringar beskriver signalrespons – inte verifierad anatomi.
        </Text>
        <AppButton label="Kör scannerdiagnostik" onPress={() => setDiagnostic(runScannerCoreDiagnostic())} />
      </Card>

      {diagnostic ? (
        <Card>
          <View style={styles.header}>
            <Text style={styles.sectionTitle}>Core-diagnostik</Text>
            <StatusPill level={diagnostic.passed ? 'normal' : 'elevated'} label={diagnostic.passed ? 'Godkänd' : 'Fel'} />
          </View>
          {diagnostic.checks.map((check) => (
            <View style={styles.checkRow} key={check.name}>
              <Text style={styles.checkName}>{check.passed ? '✓' : '×'} {check.name}</Text>
              <Text style={styles.checkDetail}>{check.detail}</Text>
            </View>
          ))}
          <Text style={styles.profileLabel}>NORMALISERAD RANGEPROFIL</Text>
          <View style={styles.profile}>
            {diagnostic.profile.map((value, index) => (
              <View
                key={`${index}-${value}`}
                style={[styles.bar, { height: Math.max(3, Math.round(value * 80)) }]}
              />
            ))}
          </View>
        </Card>
      ) : null}

      {scannerHardwareProfiles.map((profile) => (
        <Card key={profile.id} muted={profile.maturity !== 'selected-poc'}>
          <View style={styles.header}>
            <View style={styles.copy}>
              <Text style={styles.sectionTitle}>{profile.name}</Text>
              <Text style={styles.meta}>{profile.frequencyRange} · {profile.channels} kanal(er)</Text>
            </View>
            <StatusPill
              level={profile.maturity === 'selected-poc' ? 'normal' : 'observe'}
              label={profile.maturity === 'selected-poc' ? 'Vald PoC' : profile.maturity === 'secondary-poc' ? 'Sekundär' : 'Forskning'}
            />
          </View>
          {profile.strengths.map((strength) => <Text style={styles.body} key={strength}>• {strength}</Text>)}
          {profile.limitations.map((limitation) => <Text style={styles.limitation} key={limitation}>Begränsning: {limitation}</Text>)}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: '#E8F5F1' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  copy: { flex: 1, gap: spacing.xs },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: colors.ink, fontSize: 21, fontWeight: '700', lineHeight: 27 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  body: { color: colors.inkMuted, fontSize: 13, lineHeight: 20 },
  meta: { color: colors.inkMuted, fontSize: 12 },
  limitation: { color: colors.elevated, fontSize: 12, lineHeight: 18 },
  checkRow: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm, gap: spacing.xs },
  checkName: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  checkDetail: { color: colors.inkMuted, fontSize: 12 },
  profileLabel: { color: colors.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  profile: { height: 90, flexDirection: 'row', alignItems: 'flex-end', gap: 2, padding: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radius.md },
  bar: { flex: 1, borderRadius: 2, backgroundColor: colors.primary },
});
