import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { router } from 'expo-router';

import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { colors, spacing } from '@/constants/theme';

type Sample = { timestamp: number; x: number; y: number; z: number };
type Summary = { count: number; seconds: number; rms: number; peak: number; baseline: number; frequencyHz: number | null };

const WINDOW_MS = 15000;
const SAMPLE_INTERVAL_MS = 25;

function summarize(samples: Sample[]): Summary | null {
  if (samples.length < 20) return null;
  const baseline = samples.reduce((sum, s) => sum + Math.hypot(s.x, s.y, s.z), 0) / samples.length;
  const deviations = samples.map((s) => Math.hypot(s.x, s.y, s.z) - baseline);
  const rms = Math.sqrt(deviations.reduce((sum, d) => sum + d * d, 0) / deviations.length);
  const peak = Math.max(...deviations.map(Math.abs));
  const seconds = (samples[samples.length - 1]!.timestamp - samples[0]!.timestamp) / 1000;

  // Exploratory periodicity metric only; not a heart-rate or respiratory-rate estimate.
  let bestHz: number | null = null;
  let bestPower = 0;
  const mean = deviations.reduce((sum, v) => sum + v, 0) / deviations.length;
  for (let hz = 0.1; hz <= 2.0; hz += 0.05) {
    let real = 0;
    let imag = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const phase = 2 * Math.PI * hz * (samples[i]!.timestamp - samples[0]!.timestamp) / 1000;
      real += (deviations[i]! - mean) * Math.cos(phase);
      imag += (deviations[i] - mean) * Math.sin(phase);
    }
    const power = real * real + imag * imag;
    if (power > bestPower) { bestPower = power; bestHz = hz; }
  }
  return { count: samples.length, seconds, rms, peak, baseline, frequencyHz: bestHz };
}

export default function PhoneSensorsScreen() {
  const [running, setRunning] = useState(false);
  const [count, setCount] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const samples = useRef<Sample[]>([]);
  const started = useRef(0);

  useEffect(() => {
    if (!running) return;
    let active = true;
    let subscription: ReturnType<typeof Accelerometer.addListener> | undefined;
    const begin = async () => {
      try {
        const available = await Accelerometer.isAvailableAsync();
        if (!available) throw new Error('Accelerometern är inte tillgänglig.');
        Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);
        started.current = Date.now();
        samples.current = [];
        subscription = Accelerometer.addListener(({ x, y, z }) => {
          if (!active) return;
          const now = Date.now();
          samples.current.push({ timestamp: now, x, y, z });
          if (samples.current.length % 10 === 0) setCount(samples.current.length);
          if (now - started.current >= WINDOW_MS) {
            setSummary(summarize(samples.current));
            setRunning(false);
          }
        });
      } catch (e) {
        if (active) { setError(e instanceof Error ? e.message : String(e)); setRunning(false); }
      }
    };
    void begin();
    return () => { active = false; subscription?.remove(); };
  }, [running]);

  const start = () => { setError(null); setSummary(null); setCount(0); setRunning(true); };
  const stop = () => { setSummary(summarize(samples.current)); setRunning(false); };

  return (
    <Screen title="iPhone Sensor Lab" subtitle="Verklig rörelsemätning · ingen extern utrustning">
      <Card muted>
        <Text style={styles.heading}>Vad mäts?</Text>
        <Text style={styles.body}>Telefonens accelerometer registrerar rörelser och vibrationer. Detta är inte en bild av organ, ett EKG eller en medicinsk hjärtundersökning.</Text>
      </Card>
      <Card>
        <Text style={styles.heading}>15 sekunders mätning</Text>
        <Text style={styles.body}>Lägg telefonen stilla på ett stabilt underlag eller håll den varsamt mot bröstkorgen. Andas normalt. Undvik att flytta telefonen under mätningen.</Text>
        <Text style={styles.counter}>{running ? `Samlar data · ${count} prover` : summary ? 'Mätning klar' : 'Redo att mäta'}</Text>
        {running ? <AppButton label="Avsluta och analysera" secondary onPress={stop} /> : <AppButton label="Starta riktig sensormätning" onPress={start} />}
      </Card>
      {error ? <Card><Text style={styles.error}>{error}</Text></Card> : null}
      {summary ? (
        <Card>
          <Text style={styles.heading}>Uppmätt rörelsesignal</Text>
          <Text style={styles.value}>{summary.rms.toFixed(5)} g</Text>
          <Text style={styles.body}>RMS för variation i acceleration (g-enheter)</Text>
          <Text style={styles.body}>Prover: {summary.count} · Tid: {summary.seconds.toFixed(1)} s</Text>
          <Text style={styles.body}>Största avvikelse: {summary.peak.toFixed(5)} g</Text>
          <Text style={styles.body}>Dominerande periodisk komponent (explorativ): {summary.frequencyHz?.toFixed(2) ?? '–'} Hz</Text>
          <Text style={styles.warning}>Periodicitetsvärdet är inte validerat som puls eller andningsfrekvens. Ingen anatomi eller sjukdom kan utläsas.</Text>
        </Card>
      ) : null}
      <AppButton label="Öppna simulerat Imaging Lab" secondary onPress={() => router.push('/imaging')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 17, fontWeight: '700', color: colors.ink },
  body: { fontSize: 14, lineHeight: 21, color: colors.inkMuted },
  counter: { fontSize: 16, color: colors.primary, fontWeight: '700', marginVertical: spacing.md },
  value: { fontSize: 28, fontWeight: '800', color: colors.primary },
  warning: { fontSize: 13, color: colors.elevated, lineHeight: 19 },
  error: { color: colors.urgent },
});
