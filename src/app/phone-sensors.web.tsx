import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { colors } from '@/constants/theme';
import { MotionWaveform } from '@/components/MotionWaveform.web';
import { analyzeMotionSpectrum, type SpectralReport } from '@/services/sensors/motionSpectrum';
import { analyzeMotion, type MotionPoint, type MotionReport } from '@/services/sensors/motionAnalysis';

type PermissionMotionEvent = typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
const DURATION_MS = 30000;

export default function BrowserSensorLab() {
  const [status, setStatus] = useState('Redo för mätning');
  const [report, setReport] = useState<MotionReport | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [captured, setCaptured] = useState<MotionPoint[]>([]);
  const [spectrum, setSpectrum] = useState<SpectralReport | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const readings = useRef<MotionPoint[]>([]);
  const cleanup = useRef<(() => void) | null>(null);
  const active = useRef(false);
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => () => { active.current = false; cleanup.current?.(); }, []);

  const stop = () => {
    if (!active.current) return;
    active.current = false;
    cleanup.current?.();
    cleanup.current = null;
    setRunning(false);
    const result = analyzeMotion(readings.current);
    setReport(result);
    setCaptured([...readings.current]);
    setSpectrum(analyzeMotionSpectrum(readings.current));
    setStatus(result ? 'Mätning genomförd' : 'För få mätpunkter – prova igen');
  };
  stopRef.current = stop;

  const start = async () => {
    if (active.current) return;
    setReport(null);
    setCaptured([]);
    setSpectrum(null);
    setCopyStatus('');
    setElapsed(0);
    readings.current = [];
    try {
      if (!('DeviceMotionEvent' in window)) throw new Error('Rörelsesensor saknas i den här webbläsaren.');
      const motion = DeviceMotionEvent as PermissionMotionEvent;
      if (typeof motion.requestPermission === 'function') {
        const permission = await motion.requestPermission();
        if (permission !== 'granted') throw new Error('Rörelsebehörighet nekades. Tillåt åtkomst i Safari.');
      }
      const startTime = performance.now();
      active.current = true;
      const listener = (event: DeviceMotionEvent) => {
        const a = event.accelerationIncludingGravity;
        if (!a || a.x == null || a.y == null || a.z == null) return;
        if (![a.x, a.y, a.z].every(Number.isFinite)) return;
        readings.current.push({ t: performance.now(), x: a.x, y: a.y, z: a.z });
      };
      window.addEventListener('devicemotion', listener);
      const interval = window.setInterval(() => setElapsed(Math.min(30, Math.floor((performance.now() - startTime) / 1000))), 250);
      const timeout = window.setTimeout(() => stopRef.current(), DURATION_MS);
      cleanup.current = () => {
        window.removeEventListener('devicemotion', listener);
        window.clearInterval(interval);
        window.clearTimeout(timeout);
      };
      setRunning(true);
      setStatus('Samlar verkliga rörelsedata…');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Kunde inte läsa rörelsesensorn');
    }
  };

  const copyForAI = async () => {
    if (!report || captured.length === 0) return;
    const payload = {
      source: 'ScanIt iPhone browser accelerometer', timestamp: new Date().toISOString(),
      measurement: 'accelerationIncludingGravity', units: 'm/s²',
      caution: 'Not an ECG, heart rate, or validated clinical measurement. Do not infer diagnoses.',
      summary: report,
      exploratorySpectrum: spectrum,
      samples: captured.map(p => [Math.round(p.t - captured[0]!.t), Number(p.x.toFixed(5)), Number(p.y.toFixed(5)), Number(p.z.toFixed(5))]),
      columns: ['elapsed_ms','ax','ay','az'],
      analysis_request: 'Beskriv mätkvalitet, rörelseartefakter och eventuella återkommande mönster. Ange tydligt vad som INTE kan utläsas ur dessa accelerometerdata. Hitta inte på puls, EKG eller diagnos.'
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload));
      setCopyStatus('Mätdata kopierade. Klistra in i valfri AI-chatt.');
    } catch {
      setCopyStatus('Kopiering blockerades av Safari. Kontrollera urklippsbehörighet.');
    }
  };

  return (
    <Screen title="ScanIt · Rörelse" subtitle="Riktig iPhone-mätning utan extern utrustning">
      <Card>
        <Text style={styles.heading}>Mät små rörelser med telefonen</Text>
        <Text style={styles.body}>Placera telefonen stilla mot bröstkorgen eller på ett stabilt underlag. Undvik att hålla den i handen. Mät i 30 sekunder med skärmen aktiv.</Text>
        <Text style={styles.status}>{status}</Text>
        {running ? <Text style={styles.timer}>{elapsed} / 30 sekunder</Text> : null}
        {running ? <AppButton label="Avsluta mätning" secondary onPress={stop} /> : <AppButton label="Starta verklig mätning" onPress={start} />}
      </Card>

      {report ? <>
        {spectrum ? <Card>
          <Text style={styles.heading}>Frekvensanalys · experimentell</Text>
          {spectrum.bands.map(b => <Text key={b.name} style={styles.body}>{b.name} ({b.fromHz}–{b.toHz} Hz): starkaste komponent {b.peakHz === null ? 'ej identifierad' : `${b.peakHz.toFixed(2)} Hz`}</Text>)}
          <Text style={styles.body}>Stabilitet mellan två tidsfönster: {spectrum.windowsAgree ? 'Liknande dominerande frekvens' : 'Ej bekräftad'}</Text>
          <Text style={styles.caption}>{spectrum.warning}</Text>
        </Card> : null}
        <Card>
          <Text style={styles.eyebrow}>RESULTAT · SIGNALKVALITET</Text>
          <Text style={styles.resultTitle}>{report.qualityText}</Text>
          <Text style={styles.body}>{report.interpretation}</Text>
          <Text style={styles.heading}>Rörelser under mätningen</Text>
          <MotionWaveform samples={captured} />
          <Text style={styles.heading}>Översikt över rörelseintensitet</Text>
          <View style={styles.chart} accessibilityLabel="Diagram över uppmätt rörelsevariation under 30 sekunder">
            {report.segments.map((value, index) => {
              const max = Math.max(0.05, ...report.segments);
              return <View key={index} style={[styles.bar, { height: Math.max(3, Math.min(88, (value / max) * 88)) }]} />;
            })}
          </View>
          <Text style={styles.caption}>Vänster = början, höger = slutet. Högre stapel betyder större rörelse, inte starkare hjärtslag.</Text>
        </Card>
        <Card>
          <Text style={styles.heading}>Vad vet vi?</Text>
          <Text style={styles.body}>Telefonen registrerade verkliga rörelser i {report.durationSeconds.toFixed(1)} sekunder. Vi har ännu inte identifierat någon fysiologisk signal med tillräcklig säkerhet för att visa puls eller andningsfrekvens.</Text>
          <Text style={styles.heading}>För bättre mätning</Text>
          <Text style={styles.body}>Använd samma placering varje gång, låt telefonen vila helt och undvik rörelse omkring den. Upprepa gärna mätningen och jämför kurvornas form.</Text>
        </Card>
        <Card>
          <Text style={styles.heading}>Dela mätningen för AI-analys</Text>
          <Text style={styles.body}>Kopiera hela accelerometerserien, tidsstämplar och kvalitetsanalys i JSON-format. Ingen data skickas automatiskt.</Text>
          <AppButton label="Kopiera mätdata till AI" onPress={copyForAI} />
          {copyStatus ? <Text style={styles.status}>{copyStatus}</Text> : null}
        </Card>
        <Card muted>
          <Text style={styles.heading}>Tekniska detaljer</Text>
          <Text style={styles.body}>{report.count} prover · {report.samplingHz.toFixed(0)} prover/sekund · {report.gaps} dataluckor</Text>
          <Text style={styles.body}>Rörelsevariation: {report.variationRms.toFixed(4)} m/s²</Text>
          <Text style={styles.body}>Största rörelseavvikelse: {report.peakDeviation.toFixed(4)} m/s²</Text>
          <Text style={styles.caption}>Kvalitetsbedömningen bygger på experimentella gränser för rörelsestörningar och datatäckning, inte medicinska normalvärden.</Text>
        </Card>
      </> : null}
      <AppButton label="Simulerad bildrekonstruktion (separat demo)" secondary onPress={() => router.push('/imaging')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  body: { fontSize: 14, lineHeight: 21, color: colors.inkMuted },
  status: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  timer: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  eyebrow: { color: colors.primary, fontSize: 11, letterSpacing: 1, fontWeight: '800' },
  resultTitle: { color: colors.ink, fontSize: 26, fontWeight: '800' },
  chart: { height: 110, flexDirection: 'row', alignItems: 'flex-end', gap: 2, paddingVertical: 8 },
  bar: { flex: 1, backgroundColor: colors.primary, borderRadius: 2 },
  caption: { color: colors.inkMuted, fontSize: 12, lineHeight: 18 },
});
