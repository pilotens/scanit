import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import {
  CURRENT_CONSENT_VERSION,
  type ConsentRecord,
  type UserProfile,
} from '@/domain/onboarding';
import { useAppState } from '@/state/AppProvider';

const currentYear = new Date().getFullYear();

export default function OnboardingScreen() {
  const {
    profile: existingProfile,
    completeOnboarding,
    connectAndImportHealthKit,
    healthKitSupported,
  } = useAppState();
  const [displayName, setDisplayName] = useState(existingProfile?.displayName ?? '');
  const [birthYear, setBirthYear] = useState(
    existingProfile?.birthYear ? String(existingProfile.birthYear) : '',
  );
  const [prototypeAccepted, setPrototypeAccepted] = useState(false);
  const [storageAccepted, setStorageAccepted] = useState(false);
  const [healthKitAccepted, setHealthKitAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [onboardingSaved, setOnboardingSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedBirthYear = useMemo(() => {
    if (!birthYear.trim()) return undefined;
    const value = Number.parseInt(birthYear, 10);
    return Number.isInteger(value) ? value : Number.NaN;
  }, [birthYear]);

  const birthYearIsValid =
    parsedBirthYear === undefined ||
    (Number.isFinite(parsedBirthYear) && parsedBirthYear >= 1900 && parsedBirthYear <= currentYear);
  const canSubmit = prototypeAccepted && storageAccepted && birthYearIsValid && !isSubmitting;

  const continueToApp = () => router.replace('/(tabs)');

  const submit = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);
    const now = new Date().toISOString();
    const profile: UserProfile = {
      id: existingProfile?.id ?? `profile-${Date.now()}`,
      displayName: displayName.trim() || undefined,
      birthYear: parsedBirthYear,
      createdAt: existingProfile?.createdAt ?? now,
      updatedAt: now,
    };
    const consent: ConsentRecord = {
      version: CURRENT_CONSENT_VERSION,
      acceptedAt: now,
      researchPrototypeAccepted: prototypeAccepted,
      encryptedLocalStorageAccepted: storageAccepted,
      healthKitReadAccepted: healthKitSupported && healthKitAccepted,
    };

    try {
      await completeOnboarding(profile, consent);
      setOnboardingSaved(true);
      if (healthKitSupported && healthKitAccepted) {
        await connectAndImportHealthKit();
      }
      continueToApp();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Introduktionen kunde inte slutföras.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Screen
      title="Välkommen till ScanIt"
      subtitle="Konfigurera den lokala forskningsappen innan första mätningen">
      <Card>
        <Text style={styles.sectionTitle}>Frivillig profil</Text>
        <Text style={styles.body}>
          Profiluppgifterna används endast lokalt för framtida individanpassning.
        </Text>
        <TextInput
          accessibilityLabel="Namn"
          autoCapitalize="words"
          placeholder="Namn eller alias"
          placeholderTextColor={colors.inkMuted}
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
        />
        <TextInput
          accessibilityLabel="Födelseår"
          keyboardType="number-pad"
          maxLength={4}
          placeholder="Födelseår, frivilligt"
          placeholderTextColor={colors.inkMuted}
          style={styles.input}
          value={birthYear}
          onChangeText={setBirthYear}
        />
        {!birthYearIsValid ? (
          <Text style={styles.error}>Ange ett år mellan 1900 och {currentYear}.</Text>
        ) : null}
      </Card>

      <Card>
        <ConsentRow
          label="Jag förstår att detta är en forskningsprototyp"
          description="ScanIt diagnostiserar eller utesluter inte sjukdom och får inte försena kontakt med vården."
          value={prototypeAccepted}
          onValueChange={setPrototypeAccepted}
        />
        <View style={styles.separator} />
        <ConsentRow
          label="Jag godkänner krypterad lokal lagring"
          description="Profil, importerade mätvärden och skanningar lagras på enheten."
          value={storageAccepted}
          onValueChange={setStorageAccepted}
        />
      </Card>

      {Platform.OS === 'ios' ? (
        <Card muted>
          <ConsentRow
            label="Anslut Apple Health"
            description={
              healthKitSupported
                ? 'Begär läsåtkomst till puls, SDNN-HRV, syremättnad, handledstemperatur och EKG-sammanfattningar. Du väljer exakt åtkomst i Apples dialog.'
                : 'Kräver en signerad iOS-build med HealthKit. Funktionen finns inte i Expo Go eller webbversionen.'
            }
            value={healthKitAccepted}
            onValueChange={setHealthKitAccepted}
            disabled={!healthKitSupported}
          />
          <Text style={styles.privacyNote}>
            Apple visar inte för appen om en enskild läsbehörighet nekades. Ett tomt värde kan därför även betyda att data saknas.
          </Text>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <Text style={styles.error}>{error}</Text>
          {onboardingSaved ? (
            <AppButton label="Fortsätt utan Apple Health" onPress={continueToApp} secondary />
          ) : null}
        </Card>
      ) : null}

      <AppButton
        label={isSubmitting ? 'Sparar och ansluter' : 'Godkänn och fortsätt'}
        onPress={() => void submit()}
        disabled={!canSubmit}
      />
    </Screen>
  );
}

type ConsentRowProps = {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
};

function ConsentRow({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
}: ConsentRowProps) {
  return (
    <View style={styles.consentRow}>
      <View style={styles.consentCopy}>
        <Text style={styles.consentLabel}>{label}</Text>
        <Text style={styles.body}>{description}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor={value ? colors.primary : colors.white}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  body: { color: colors.inkMuted, fontSize: 13, lineHeight: 19 },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  consentCopy: { flex: 1, gap: spacing.xs },
  consentLabel: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  privacyNote: { color: colors.inkMuted, fontSize: 11, lineHeight: 17 },
  error: { color: colors.urgent, fontSize: 13, lineHeight: 19, fontWeight: '600' },
});
