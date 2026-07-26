import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { ScannerLabPanel } from '@/components/scanner/ScannerLabPanel';
import { TomographyResearchPanel } from '@/components/scanner/TomographyResearchPanel';
import { WifiSensingPanel } from '@/components/scanner/WifiSensingPanel';
import { Screen } from '@/components/Screen';
import { StatusPill } from '@/components/StatusPill';
import { colors, radius, spacing } from '@/constants/theme';
import type { ScannerCoreDiagnostic, ScannerTrack } from '@/domain/radio';
import { ScannerGatewayClient } from '@/services/scanner/gateway/scannerGatewayClient';
import type { ScannerGatewayStatus } from '@/services/scanner/gateway/types';
import { scannerHardwareProfiles } from '@/services/scanner/hardwareProfiles';
import { scannerRuntime } from '@/services/scanner/runtime/scannerRuntime';
import { runScannerCoreDiagnostic } from '@/services/scanner/selfTest';

const tracks: Array<{ value: ScannerTrack; label: string; description: string }> = [
  {
    value: 'vital-motion',
    label: 'Vital mikrorörelse',
    description: '60 GHz, UWB och Wi-Fi CSI för andning, rörelse och mekanisk periodicitet.',
  },
  {
    value: 'microwave-tomography',
    label: 'Mikrovågstomografi',
    description: 'Specialbyggd multistatisk array för differential spridningskontrast.',
  },
];

export default function ScannerScreen() {
  const [selectedTrack, setSelectedTrack] = useState<ScannerTrack>('vital-motion');
  const [diagnostic, setDiagnostic] = useState<ScannerCoreDiagnostic | null>(null);
  const [gatewayUrl, setGatewayUrl] = useState('ws://192.168.4.1:8765');
  const [gatewayStatus, setGatewayStatus] = useState<ScannerGatewayStatus | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [runtimeMode, setRuntimeMode] = useState(scannerRuntime.getState().mode);

  const connectGateway = async () => {
    setConnecting(true);
    setConnectionError(null);
    const client = new ScannerGatewayClient(gatewayUrl.trim());
    try {
      const status = await client.connect();
      if (!status.deviceConnected) {
        throw new Error('Gatewayen hittades men radarsensorn är inte ansluten.');
      }
      scannerRuntime.useGateway(gatewayUrl.trim());
      setRuntimeMode('gateway');
      setGatewayStatus(status);
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : 'Kunde inte ansluta till scannern.',
      );
    } finally {
      client.disconnect();
      setConnecting(false);
    }
  };

  const useEmulator = () => {
    scannerRuntime.useEmulator();
    setRuntimeMode('emulator');
    setGatewayStatus(null);
    setConnectionError(null);
  };

  const hardwareProfiles = scannerHardwareProfiles.filter(
    ({ track }) => track === selectedTrack,
  );

  return (
    <Screen
      title="Scanner"
      subtitle="Separata mätkedjor för kardiorespiratorisk mikrorörelse och experimentell mikrovågstomografi">
      <Card style={styles.trackCard}>
        <Text style={styles.sectionTitle}>Teknikspår</Text>
        <Text style={styles.body}>
          Spåren delar sessionshantering men inte signalmodell, kvalitetsgrind eller tillåtna slutsatser.
        </Text>
        <View style={styles.trackOptions}>
          {tracks.map((track) => (
            <Pressable
              accessibilityRole="button"
              key={track.value}
              onPress={() => setSelectedTrack(track.value)}
              style={[
                styles.trackOption,
                selectedTrack === track.value && styles.trackOptionSelected,
              ]}>
              <Text
                style={[
                  styles.trackLabel,
                  selectedTrack === track.value && styles.trackLabelSelected,
                ]}>
                {track.label}
              </Text>
              <Text
                style={[
                  styles.trackDescription,
                  selectedTrack === track.value && styles.trackDescriptionSelected,
                ]}>
                {track.description}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {selectedTrack === 'vital-motion' ? (
        <>
          <Card style={styles.hero}>
            <View style={styles.header}>
              <View style={styles.copy}>
                <Text style={styles.eyebrow}>FORSKNINGSSPÅR A</Text>
                <Text style={styles.title}>Kontaktlös kardiorespiratorisk mekanik</Text>
              </View>
              <StatusPill
                level={runtimeMode === 'gateway' ? 'normal' : 'observe'}
                label={runtimeMode === 'gateway' ? 'Fysisk scanner' : 'Emulator'}
              />
            </View>
            <Text style={styles.body}>
              BGT60TR13C och Wi-Fi CSI har nu separata rådataformat och signalmodeller. Båda mäter RF-modulerad rörelse; inget av dem avbildar kranskärl.
            </Text>
            <AppButton
              label="Kör scannerdiagnostik"
              onPress={() => setDiagnostic(runScannerCoreDiagnostic())}
            />
          </Card>

          <WifiSensingPanel />

          <Card>
            <Text style={styles.sectionTitle}>Fysisk 60 GHz-gateway</Text>
            <Text style={styles.body}>
              Starta Python-gatewayen på datorn eller Raspberry Pi som är USB-ansluten till radarens MCU7-baseboard och ange dess lokala adress.
            </Text>
            <TextInput
              accessibilityLabel="Scanner gateway URL"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setGatewayUrl}
              placeholder="ws://192.168.1.50:8765"
              style={styles.input}
              value={gatewayUrl}
            />
            <AppButton
              label={connecting ? 'Ansluter…' : 'Testa och använd gateway'}
              onPress={() => void connectGateway()}
              disabled={connecting}
            />
            <AppButton
              label="Använd emulator"
              onPress={useEmulator}
              secondary
              disabled={runtimeMode === 'emulator'}
            />
            {gatewayStatus ? (
              <View style={styles.gatewayFacts}>
                <Text style={styles.meta}>Källa: {gatewayStatus.source}</Text>
                <Text style={styles.meta}>Kort: {gatewayStatus.boardUuid ?? 'okänt UUID'}</Text>
                <Text style={styles.meta}>RDK: {gatewayStatus.sdkVersion ?? 'okänd version'}</Text>
              </View>
            ) : null}
            {connectionError ? <Text style={styles.error}>{connectionError}</Text> : null}
          </Card>

          <ScannerLabPanel />

          {diagnostic ? (
            <Card>
              <View style={styles.header}>
                <Text style={styles.sectionTitle}>Core-diagnostik</Text>
                <StatusPill
                  level={diagnostic.passed ? 'normal' : 'elevated'}
                  label={diagnostic.passed ? 'Godkänd' : 'Fel'}
                />
              </View>
              {diagnostic.checks.map((check) => (
                <View style={styles.checkRow} key={check.name}>
                  <Text style={styles.checkName}>
                    {check.passed ? '✓' : '×'} {check.name}
                  </Text>
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
        </>
      ) : (
        <TomographyResearchPanel />
      )}

      {hardwareProfiles.map((profile) => (
        <Card key={profile.id} muted={profile.maturity !== 'selected-poc'}>
          <View style={styles.header}>
            <View style={styles.copy}>
              <Text style={styles.sectionTitle}>{profile.name}</Text>
              <Text style={styles.meta}>
                {profile.frequencyRange} · {profile.channels} kanal(er)
              </Text>
            </View>
            <StatusPill
              level={profile.maturity === 'selected-poc' ? 'normal' : 'observe'}
              label={
                profile.maturity === 'selected-poc'
                  ? 'Vald PoC'
                  : profile.maturity === 'secondary-poc'
                    ? 'Sekundär'
                    : 'Forskning'
              }
            />
          </View>
          {profile.strengths.map((strength) => (
            <Text style={styles.body} key={strength}>• {strength}</Text>
          ))}
          {profile.limitations.map((limitation) => (
            <Text style={styles.limitation} key={limitation}>
              Begränsning: {limitation}
            </Text>
          ))}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  trackCard: { backgroundColor: colors.surface },
  trackOptions: { gap: spacing.sm },
  trackOption: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surfaceMuted,
  },
  trackOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  trackLabel: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  trackLabelSelected: { color: colors.white },
  trackDescription: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  trackDescriptionSelected: { color: colors.white },
  hero: { backgroundColor: '#E8F5F1' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  copy: { flex: 1, gap: spacing.xs },
  eyebrow: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: colors.ink, fontSize: 21, fontWeight: '700', lineHeight: 27 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  body: { color: colors.inkMuted, fontSize: 13, lineHeight: 20 },
  meta: { color: colors.inkMuted, fontSize: 12 },
  limitation: { color: colors.elevated, fontSize: 12, lineHeight: 18 },
  input: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  gatewayFacts: {
    gap: spacing.xs,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  error: { color: colors.urgent, fontSize: 12, lineHeight: 18 },
  checkRow: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  checkName: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  checkDetail: { color: colors.inkMuted, fontSize: 12 },
  profileLabel: { color: colors.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  profile: {
    height: 90,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    padding: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
  },
  bar: { flex: 1, borderRadius: 2, backgroundColor: colors.primary },
});