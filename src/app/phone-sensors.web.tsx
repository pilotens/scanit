import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { colors } from '@/constants/theme';

type Reading = { t: number; x: number; y: number; z: number };
type PermissionMotionEvent = typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
const DURATION_MS = 15000;

export default function BrowserSensorLab() {
  const [status, setStatus] = useState('Redo');
  const [result, setResult] = useState<{ count: number; duration: number; rms: number; peak: number } | null>(null);
  const readings = useRef<Reading[]>([]);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const stop = () => {
    cleanup.current?.();
    cleanup.current = null;
    const points = readings.current;
    if (!points.length) { setStatus('Inga sensordata mottogs. Kontrollera behörighet och HTTPS.'); return; }
    const values = points.map((p) => Math.hypot(p.x, p.y, p.z));
    const avg = values.reduce((s, x) => s + x, 0) / values.length;
    const delta = values.map((x) => x - avg);
    setResult({
      count: points.length,
      duration: (points[points.length - 1].t - points[0].t) / 1000,
      rms: Math.sqrt(delta.reduce((s, x) => s + x * x, 0) / delta.length),
      peak: Math.max(...delta.map(Math.abs)),
    });
    setStatus('Mätning klar');
  };

  const start = async () => {
    cleanup.current?.();
    readings.current = [];
    setResult(null);
    try {
      if (!('DeviceMotionEvent' in window)) throw new Error('Webbläsaren erbjuder inte rörelsedata.');
      const motion = DeviceMotionEvent as PermissionMotionEvent;
      if (typeof motion.requestPermission === 'function') {
        const permission = await motion.requestPermission();
        if (permission !== 'granted') throw new Error('Rörelsebehörighet nekades.');
      }
      const listener = (event: DeviceMotionEvent) => {
        const a = event.accelerationIncludingGravity;
        if (!a || a.x === null || a.y === null || a.z === null) return;
        readings.current.push({ t: performance.now(), x: a.x, y: a.y, z: a.z });
      };
      window.addEventListener('devicemotion', listener);
      const timeout = window.setTimeout(stop, DURATION_MS);
      cleanup.current = () => {
        window.removeEventListener('devicemotion', listener);
        window.clearTimeout(timeout);
      };
      setStatus('Mäter i 15 sekunder…');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Kunde inte läsa rörelsesensorn');
    }
  };

  return (
    <Screen title="iPhone Sensor Lab" subtitle="Webbläsarbaserad rörelsemätning">
      <Card muted>
        <Text style={styles.heading}>Verkliga sensorer, inte anatomisk skanning</Text>
        <Text style={styles.body}>Safari kan med ditt tillstånd läsa accelerometerns rörelsedata. Det ger ingen bild av hjärta, lungor eller andra organ.</Text>
      </Card>
      <Card>
        <Text style={styles.heading}>15 sekunders rörelsemätning</Text>
        <Text style={styles.body}>Håll telefonen stilla. Tryck på start och godkänn rörelsesensorer när Safari frågar.</Text>
        <Text style={styles.status}>{status}</Text>
        <AppButton label="Starta mätning" onPress={start} />
        <AppButton label="Stoppa" secondary onPress={stop} />
      </Card>
      {result ? <Card>
        <Text style={styles.heading}>Mätresultat</Text>
        <Text style={styles.body}>Prover: {result.count}</Text>
        <Text style={styles.body}>Tid: {result.duration.toFixed(1)} s</Text>
        <Text style={styles.body}>Rörelsevariation RMS: {result.rms.toFixed(4)} m/s²</Text>
        <Text style={styles.body}>Största avvikelse: {result.peak.toFixed(4)} m/s²</Text>
        <Text style={styles.body}>Ej validerat för puls, andning eller sjukdomsbedömning.</Text>
      </Card> : null}
      <AppButton label="Öppna simulerad 3D-rekonstruktion" secondary onPress={() => router.push('/imaging')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 17, fontWeight: '700', color: colors.ink },
  body: { fontSize: 14, lineHeight: 21, color: colors.inkMuted },
  status: { color: colors.primary, fontSize: 16, fontWeight: '700' },
});
