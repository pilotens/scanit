import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { colors } from '@/constants/theme';
import { MotionWaveform } from '@/components/MotionWaveform.web';
import { summarizeRepeats, type RepeatEntry } from '@/services/sensors/scgRepeatability';
import { analyzeScg, type ScgReport } from '@/services/sensors/scgAnalysis';
import { analyzeMotionSpectrum, type SpectralReport } from '@/services/sensors/motionSpectrum';
import { analyzeMotion, type MotionPoint, type MotionReport } from '@/services/sensors/motionAnalysis';

type PermissionMotionEvent = typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
const DURATION_MS = 30000;
const REQUESTED_SENSOR_HZ = 200;
const HISTORY_KEY = 'scanit-personal-signal-history-v1';
type AudioFrame = {t:number;rms:number;peak:number};
type MultiCapture = {origin:number;gyro:MotionPoint[];audio:AudioFrame[];audioStatus:string;audioSampleRate:number|null};
const emptyMulti=():MultiCapture=>({origin:0,gyro:[],audio:[],audioStatus:'not requested',audioSampleRate:null});
function summarizeChannel(p:MotionPoint[], low:number, high:number){
  if(p.length<100)return null;
  const duration=(p[p.length-1]!.t-p[0]!.t)/1000;
  if(duration<15)return null;
  const axes=(['x','y','z'] as const).map(axis=>{
    const mean=p.reduce((a,b)=>a+b[axis],0)/p.length;
    const rms=Math.sqrt(p.reduce((a,b)=>a+(b[axis]-mean)**2,0)/p.length);
    let best=0,frequency:number|null=null;
    for(let f=low;f<=high;f+=1/duration){
      let re=0,im=0;
      for(const q of p){const phase=2*Math.PI*f*(q.t-p[0]!.t)/1000;re+=(q[axis]-mean)*Math.cos(phase);im+=(q[axis]-mean)*Math.sin(phase);}
      const power=(re*re+im*im)/(p.length*p.length);
      if(power>best){best=power;frequency=f;}
    }
    return {axis,rms,frequencyHz:frequency,power:best};
  });
  return {durationSeconds:duration,count:p.length,axes,origin:'unverified mechanical',gaps:p.slice(1).filter((q,i)=>q.t-p[i]!.t>50).length};
}
type Posture = 'supine' | 'reclined45';
type PersonalEntry = {timestamp: string; mode: 'sternum' | 'table'; rms: number; scg: ScgReport | null; referenceBpm: number | null; note: string; posture?: Posture; durationSeconds?: number};

export default function BrowserSensorLab() {
  const [status, setStatus] = useState('Redo för mätning');
  const [report, setReport] = useState<MotionReport | null>(null);
  const [running, setRunning] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [wakeStatus, setWakeStatus] = useState('');
  const [sensorSource, setSensorSource] = useState('DeviceMotion');
  const [elapsed, setElapsed] = useState(0);
  const [captured, setCaptured] = useState<MotionPoint[]>([]);
  const [spectrum, setSpectrum] = useState<SpectralReport | null>(null);
  const [mode, setMode] = useState<'sternum' | 'table'>('sternum');
  const [posture, setPosture] = useState<Posture>('reclined45');
  const [measurementPosture, setMeasurementPosture] = useState<Posture>('reclined45');
  const [captureSeconds, setCaptureSeconds] = useState(0);
  const [scg, setScg] = useState<ScgReport | null>(null);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<PersonalEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [measuredReference, setMeasuredReference] = useState<number | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [repeats, setRepeats] = useState<{sternum: RepeatEntry[]; table: RepeatEntry[]}>({sternum: [], table: []});
  const [controls, setControls] = useState<{sternum?: {motion: MotionReport; spectrum: SpectralReport | null}; table?: {motion: MotionReport; spectrum: SpectralReport | null}}>({});
  const measurementMode = useRef<'sternum' | 'table'>('sternum');
  const postureRef = useRef<Posture>('reclined45');
  const readings = useRef<MotionPoint[]>([]);
  const multi=useRef<MultiCapture>(emptyMulti());
  const [multiResult,setMultiResult]=useState<MultiCapture|null>(null);
  const [micEnabled,setMicEnabled]=useState(true);
  const audioCleanup=useRef<(()=>void)|null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const active = useRef(false);
  const stopRef = useRef<() => void>(() => {});
  const wakeLock = useRef<{release: () => Promise<void>} | null>(null);
  const starting = useRef(false);
  const releaseWake = () => {const lock=wakeLock.current;wakeLock.current=null;if(lock)void lock.release().catch(()=>{});};

  useEffect(() => () => { active.current = false; cleanup.current?.();audioCleanup.current?.();releaseWake(); }, []);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(HISTORY_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const safe = parsed.filter((v): v is PersonalEntry =>
            v !== null && typeof v === 'object' && typeof v.timestamp === 'string' &&
            (v.mode === 'sternum' || v.mode === 'table') &&
            typeof v.rms === 'number' && Number.isFinite(v.rms));
          setHistory(safe.slice(-100));
        }
      }
    } catch { setStatus('Kunde inte läsa lokal historik; nya mätningar kan fortfarande göras.'); }
    setHistoryLoaded(true);
  }, []);
  useEffect(() => {
    if (!historyLoaded) return;
    try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-100))); }
    catch { setStatus('Lokal lagring är otillgänglig. Exportera resultaten för att behålla dem.'); }
  }, [history, historyLoaded]);

  const stop = () => {
    if (!active.current) return;
    active.current = false;
    cleanup.current?.();
    cleanup.current = null;
    audioCleanup.current?.();audioCleanup.current=null;
    setMultiResult({...multi.current,gyro:[...multi.current.gyro],audio:[...multi.current.audio]});
    setRunning(false);
    releaseWake();
    const result = analyzeMotion(readings.current);
    const spectralResult = analyzeMotionSpectrum(readings.current);
    const scgResult = measurementMode.current === 'sternum' ? analyzeScg(readings.current) : null;
    if (result) {
      const validRef = reference.trim() && Number(reference)>=35 && Number(reference)<=220 ? Number(reference) : null;
      setHistory(previous => [...previous, {timestamp: new Date().toISOString(), mode: measurementMode.current, rms: result.variationRms, scg: scgResult, referenceBpm: validRef, note: note.slice(0,160), posture: postureRef.current, durationSeconds: result.durationSeconds}].slice(-100));
      setControls(previous => ({...previous, [measurementMode.current]: {motion: result, spectrum: spectralResult}}));
      setRepeats(previous => ({...previous, [measurementMode.current]: [...previous[measurementMode.current], {rms: result.variationRms, scg: scgResult}].slice(-5)}));
    }
    setReport(result);
    setMeasurementPosture(postureRef.current);
    setCaptureSeconds(result?.durationSeconds ?? 0);
    setCaptured([...readings.current]);
    setSpectrum(spectralResult);
    setScg(scgResult);
    setMeasuredReference(reference.trim() && Number(reference)>=35 && Number(reference)<=220 ? Number(reference) : null);
    setStatus(result ? result.durationSeconds < 29 ? 'Ofullständig registrering: mindre än 29 sekunder sensordata. Gör om mätningen.' : 'Mätning genomförd' : 'För få mätpunkter – prova igen');
  };
  stopRef.current = stop;

  const start = async () => {
    if (active.current || starting.current) return;
    starting.current=true;
    setReport(null);
    setCaptured([]);
    setSpectrum(null);
    setScg(null);
    setCopyStatus('');
    setElapsed(0);
    setSensorSource('DeviceMotion');
    readings.current = [];
    multi.current=emptyMulti();setMultiResult(null);
    measurementMode.current = mode;
    postureRef.current = posture;
    try {
      if (!('DeviceMotionEvent' in window) && !('Accelerometer' in window)) throw new Error('Rörelsesensor saknas i den här webbläsaren.');
      const motion = ('DeviceMotionEvent' in window ? DeviceMotionEvent : null) as PermissionMotionEvent | null;
      if (motion && typeof motion.requestPermission === 'function') {
        const permission = await motion.requestPermission();
        if (permission !== 'granted') throw new Error('Rörelsebehörighet nekades. Tillåt åtkomst i Safari.');
      }
      try {
        const wakeApi = navigator as Navigator & {wakeLock?: {request: (type:'screen') => Promise<{release:()=>Promise<void>}>}};
        if(wakeApi.wakeLock) {wakeLock.current=await wakeApi.wakeLock.request('screen');setWakeStatus('Skärmen hålls aktiv under mätningen.');}
        else setWakeStatus('Webbläsaren stöder inte skärmlås. Håll skärmen aktiv.');
      } catch {setWakeStatus('Kunde inte förhindra skärmlås. Håll Safari öppet.');}
      if(micEnabled){
        try{
          const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
          audioCleanup.current=()=>stream.getTracks().forEach(t=>t.stop());
          const ctx=new AudioContext();
          audioCleanup.current=()=>{stream.getTracks().forEach(t=>t.stop());void ctx.close().catch(()=>{});};
          await ctx.resume();
          const source=ctx.createMediaStreamSource(stream), analyser=ctx.createAnalyser();
          analyser.fftSize=1024;source.connect(analyser);
          const buffer=new Float32Array(analyser.fftSize);
          multi.current.audioSampleRate=ctx.sampleRate;multi.current.audioStatus='envelope capture';
          const timer=window.setInterval(()=>{
            if(!active.current)return;
            analyser.getFloatTimeDomainData(buffer);
            let sum=0,peak=0;for(const v of buffer){sum+=v*v;peak=Math.max(peak,Math.abs(v));}
            multi.current.audio.push({t:performance.now(),rms:Math.sqrt(sum/buffer.length),peak});
          },20);
          audioCleanup.current=()=>{window.clearInterval(timer);source.disconnect();stream.getTracks().forEach(t=>t.stop());void ctx.close().catch(()=>{});};
        }catch{audioCleanup.current?.();audioCleanup.current=null;multi.current.audioStatus='unavailable or denied';}
      }else multi.current.audioStatus='disabled';
      setCountdown(2);
      setStatus('Mätningen startar om 2 sekunder. Lägg telefonen stilla.');
      await new Promise<void>(resolve=>window.setTimeout(resolve,1000));
      setCountdown(1);
      await new Promise<void>(resolve=>window.setTimeout(resolve,1000));
      setCountdown(null);
      const startTime = performance.now();
      multi.current.origin=startTime;
      active.current = true;
      starting.current=false;
      const listener = (event: DeviceMotionEvent) => {
        if(!active.current)return;
        const t=performance.now(),g=event.rotationRate;
        if(g&&g.alpha!=null&&g.beta!=null&&g.gamma!=null&&[g.alpha,g.beta,g.gamma].every(Number.isFinite))multi.current.gyro.push({t,x:g.beta,y:g.gamma,z:g.alpha});
        if(usingFast)return;
        const a = event.accelerationIncludingGravity;
        if (!a || a.x == null || a.y == null || a.z == null) return;
        if (![a.x, a.y, a.z].every(Number.isFinite)) return;
        readings.current.push({ t: performance.now(), x: a.x, y: a.y, z: a.z });
      };
      // Generic Sensor API supports an explicit frequency request where implemented.
      // Safari normally exposes only DeviceMotion; do not synthesize extra samples.
      type FastAccelerometer = {x:number|null;y:number|null;z:number|null;start:()=>void;stop:()=>void;addEventListener:(name:string,cb:()=>void)=>void};
      const sensorWindow = window as Window & {Accelerometer?:new (options:{frequency:number})=>FastAccelerometer};
      let fastSensor:FastAccelerometer|null=null;
      let usingFast=false;
      if(sensorWindow.Accelerometer) {
        try {
          fastSensor=new sensorWindow.Accelerometer({frequency:REQUESTED_SENSOR_HZ});
          const sensor=fastSensor;
          sensor.addEventListener('reading',()=>{
            if(!active.current)return;
            const {x,y,z}=sensor;
            if(x==null||y==null||z==null||![x,y,z].every(Number.isFinite))return;
            readings.current.push({t:performance.now(),x,y,z});
          });
          sensor.start();
          usingFast=true;
          setSensorSource('Accelerometer API (begärt 200 Hz; faktisk frekvens visas i resultatet)');
        } catch {
          fastSensor=null;
        }
      }
      if(motion)window.addEventListener('devicemotion',listener);
      if(!usingFast) {
        if(!motion)throw new Error('Ingen tillgänglig rörelsesensor kunde startas.');
        setSensorSource('DeviceMotion (webbläsarens maximala leveransfrekvens)');
      }
      const interval = window.setInterval(() => setElapsed(Math.min(30, Math.floor((performance.now() - startTime) / 1000))), 250);
      const timeout = window.setTimeout(() => stopRef.current(), DURATION_MS);
      cleanup.current = () => {
        window.removeEventListener('devicemotion', listener);
        try{fastSensor?.stop();}catch{}
        window.clearInterval(interval);
        window.clearTimeout(timeout);
      };
      setRunning(true);
      setStatus('Samlar verkliga rörelsedata…');
    } catch (e) {
      active.current=false;cleanup.current?.();audioCleanup.current?.();audioCleanup.current=null;
      starting.current=false;
      setCountdown(null);
      releaseWake();
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
      sensorSource,
      requestedSensorHz: sensorSource.startsWith('Accelerometer API') ? REQUESTED_SENSOR_HZ : null,
      exploratorySpectrum: spectrum,
      protocol: {mode: measurementMode.current, position: measurementMode.current === 'sternum' ? (measurementPosture === 'reclined45' ? 'Reclined approximately 45 degrees, iPhone on sternum' : 'Supine, iPhone on sternum') : 'Phone resting on a stable table', referenceBpm: measuredReference, capturedDurationSeconds: captureSeconds, completeCapture: captureSeconds >= 29},
      exploratoryScg: scg,
      multimodal: multiResult ? {
        clock:'performance.now relative to common session origin; delivery timestamps, not hardware synchronization',
        accelerationStartMs:captured[0]!.t-multiResult.origin,
        gcg:{units:'degrees/s',columns:['elapsed_ms','beta','gamma','alpha'],samples:multiResult.gyro.map(p=>[p.t-multiResult.origin,p.x,p.y,p.z]),analysis:summarizeChannel(multiResult.gyro,.7,3)},
        pcg:{status:multiResult.audioStatus,sourceSampleRateHz:multiResult.audioSampleRate,columns:['elapsed_ms','rms','peak'],samples:multiResult.audio.map(p=>[p.t-multiResult.origin,p.rms,p.peak]),warning:'Audio envelope only; no raw sound or validated heart sounds'},
        resp:{acceleration:summarizeChannel(captured,.1,.5),rotation:summarizeChannel(multiResult.gyro,.1,.5),warning:'Candidate low-frequency motion, not validated respiration'}
      }:null,
      harmonicChecks: scg?.harmonicChecks ?? null,
      pairedControl: controls,
      repeatedMeasurements: repeats,
      personalHistory: history,
      repeatability: summarizeRepeats(repeats[measurementMode.current]),
      samples: captured.map(p => [Math.round(p.t - captured[0]!.t), Number(p.x.toFixed(5)), Number(p.y.toFixed(5)), Number(p.z.toFixed(5))]),
      columns: ['elapsed_ms','ax','ay','az'],
      analysis_request: 'Beskriv mätkvalitet, rörelseartefakter och återkommande mönster i SCG, GCG, PCG och RESP. Jämför tidsserier med gemensam sessionsreferens; ange osäker synkronisering. Ange tydligt vad som INTE kan utläsas ur dessa accelerometerdata. Hitta inte på puls, EKG eller diagnos.'
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload));
      setCopyStatus('Mätdata kopierade. Klistra in i valfri AI-chatt.');
    } catch {
      setCopyStatus('Kopiering blockerades av Safari. Kontrollera urklippsbehörighet.');
    }
  };

  return (
    <Screen title="ScanIt · Multimodal" subtitle="Riktig iPhone-mätning utan extern utrustning">
      <Card>
        <Text style={styles.heading}>SCG · GCG · PCG · RESP</Text>
        <Text style={styles.body}>Välj mätprotokoll. För jämförelse: mät först på bröstbenet, sedan med samma telefon på ett stabilt bord.</Text>
        <AppButton label={mode === 'sternum' ? 'Bröstben · ryggläge (valt)' : 'Välj bröstben · ryggläge'} secondary onPress={() => {if (!running) setMode('sternum');}} />
        <AppButton label={mode === 'table' ? 'Bord · kontrollmätning (valt)' : 'Välj bord · kontrollmätning'} secondary onPress={() => {if (!running) setMode('table');}} />
        <Text style={styles.heading}>Kroppsställning</Text>
        <AppButton label={posture === 'reclined45' ? 'Halvsittande cirka 45° (valt)' : 'Välj halvsittande cirka 45°'} secondary onPress={() => {if (!running && countdown === null) setPosture('reclined45');}} />
        <AppButton label={posture === 'supine' ? 'Liggande på rygg (valt)' : 'Välj liggande på rygg'} secondary onPress={() => {if (!running && countdown === null) setPosture('supine');}} />
        <Text style={styles.body}>Personligt protokoll: ligg på rygg i samma position, använd samma telefon och orientering, och låt den vila mot samma punkt på bröstbenet. Gör tre bröstmätningar i följd och en bordskontroll. Flytta inte telefonen under en mätning.</Text>
        <TextInput value={note} onChangeText={setNote} placeholder="Anteckning, t.ex. placering eller rörelse (valfritt)" style={styles.input} />
        <Text style={styles.body}>Om du har en separat pulsmätare, ange dess värde före start. Referensen sparas tillsammans med mätningen.</Text>
        <TextInput value={reference} onChangeText={setReference} keyboardType="numeric" placeholder="Referenspuls, slag/min (valfritt)" style={styles.input} />
        <Text style={styles.body}>Placera telefonen stilla mot bröstkorgen eller på ett stabilt underlag. Undvik att hålla den i handen. Mät i 30 sekunder med skärmen aktiv.</Text>
        <AppButton label={micEnabled?'Mikrofon PCG: på (tryck för av)':'Mikrofon PCG: av (tryck för på)'} secondary onPress={()=>{if(!running&&countdown===null&&!starting.current)setMicEnabled(v=>!v);}} />
        <Text style={styles.caption}>Mikrofonen kräver tillstånd. Endast ljudenergi exporteras, inte tal eller ljudinspelning.</Text>
        <Text style={styles.status}>{status}</Text>
        {countdown !== null ? <Text style={styles.timer}>Start om {countdown}…</Text> : null}
        {running ? <Text style={styles.timer}>{elapsed} / 30 sekunder</Text> : null}
        {wakeStatus ? <Text style={styles.caption}>{wakeStatus}</Text> : null}
        {running ? <AppButton label="Avsluta mätning" secondary onPress={stop} /> : countdown !== null ? <Text style={styles.body}>Vänta tills nedräkningen är klar.</Text> : <AppButton label="Starta verklig mätning" onPress={start} />}
      </Card>

      <Card>
        <Text style={styles.heading}>Min personliga mäthistorik</Text>
        <Text style={styles.body}>{history.length} sparade mätningar på den här enheten (max 100). Ingen automatisk uppladdning.</Text>
        {history.slice(-8).reverse().map((item,i) => <Text key={item.timestamp+i} style={styles.body}>{new Date(item.timestamp).toLocaleString('sv-SE')} · {item.mode === 'sternum' ? 'Bröstben' : 'Bord'} · {item.mode === 'sternum' ? (item.posture === 'reclined45' ? '45°' : item.posture === 'supine' ? 'Ryggläge' : 'Okänd ställning') : 'Kontroll'} · {item.durationSeconds === undefined ? 'Okänd längd' : item.durationSeconds.toFixed(1)+' s'} · RMS {item.rms.toFixed(4)} m/s² · {item.scg?.quality === 'candidate' ? 'Mekaniskt mönster' : 'Ej verifierat mönster'}{item.note ? ' · '+item.note : ''}</Text>)}
        <Text style={styles.caption}>Historiken ligger lokalt i webbläsaren och kan försvinna om webbplatsens data rensas. Exportera JSON efter viktiga mätningar. Resultaten visar inte hjärthälsa.</Text>
        <AppButton label="Radera lokal mäthistorik" secondary onPress={() => setHistory([])} />
      </Card>
      <Card>
        <Text style={styles.heading}>Upprepbarhet · senaste fem mätningarna</Text>
        <Text style={styles.body}>Bröstben: {repeats.sternum.length}/5 mätningar · Bord: {repeats.table.length}/5 mätningar</Text>
        {(['sternum','table'] as const).map(key => { const summary = summarizeRepeats(repeats[key]); return <View key={key}>
          <Text style={styles.heading}>{key === 'sternum' ? 'Bröstben' : 'Bord'}</Text>
          {summary ? <>
            <Text style={styles.body}>Variation i RMS mellan mätningar: {summary.rmsRangePercent.toFixed(1)} % av medelvärdet.</Text>
            <Text style={styles.body}>Variation i kandidatintervall: {summary.medianIntervalRangePercent === null ? 'Otillräckligt underlag' : `${summary.medianIntervalRangePercent.toFixed(1)} %`}</Text>
            <Text style={styles.body}>Händelsejusterad mallkorrelation: {summary.templateSimilarity === null ? 'Otillräckligt underlag' : summary.templateSimilarity.toFixed(2)} ({summary.templatePairs} jämförbara mätpar)</Text>
            <Text style={styles.body}>Direkt kurvkorrelation: {summary.waveformSimilarity === null ? 'Ej beräkningsbar' : summary.waveformSimilarity.toFixed(2)} (tidsförskjutningskänslig).</Text>
            <Text style={styles.caption}>{summary.conclusion}</Text>
          </> : <Text style={styles.body}>Minst två mätningar behövs för jämförelse.</Text>}
        </View>; })}
        <AppButton label="Nollställ upprepade mätningar" secondary onPress={() => setRepeats({sternum: [], table: []})} />
      </Card>
      {controls.sternum && controls.table ? <Card>
        <Text style={styles.heading}>Bröstkorg kontra bord · kontrollanalys</Text>
        <Text style={styles.body}>Bröstkorg: {controls.sternum.motion.variationRms.toFixed(4)} m/s² RMS</Text>
        <Text style={styles.body}>Bord: {controls.table.motion.variationRms.toFixed(4)} m/s² RMS</Text>
        <Text style={styles.resultTitle}>{(controls.sternum.motion.variationRms / Math.max(0.000001, controls.table.motion.variationRms)).toFixed(1)}× rörelsevariation</Text>
        <Text style={styles.body}>Periodiskt band (0,7–3 Hz): {(() => { const a=controls.sternum?.spectrum?.bands.find(b=>b.fromHz===0.7); const b=controls.table?.spectrum?.bands.find(b=>b.fromHz===0.7); return a && b && b.strength>0 ? `${(a.strength/b.strength).toFixed(1)}× högre spektral styrka på bröstkorgen` : 'Ej jämförbart'; })()}</Text>
        <Text style={styles.caption}>Jämförelsen visar signal över bakgrundsnivå, inte att signalen kommer från hjärtat. Samma telefon, orientering och miljö bör användas. Referens-EKG eller PPG behövs för att verifiera hjärtkoppling.</Text>
        <AppButton label="Nollställ jämförelsen" secondary onPress={() => setControls({})} />
      </Card> : <Card muted><Text style={styles.heading}>Kontrollprotokoll</Text><Text style={styles.body}>Genomför en 30-sekundersmätning på bröstbenet i ryggläge och en på ett stabilt bord. Appen jämför automatiskt resultaten när båda finns.</Text><Text style={styles.body}>Bröstkorg: {controls.sternum ? 'klar' : 'saknas'} · Bord: {controls.table ? 'klar' : 'saknas'}</Text></Card>}
      {multiResult ? <Card>
        <Text style={styles.heading}>Kompletterande sensorer</Text>
        <Text style={styles.body}>GCG: {multiResult.gyro.length} rotationsprover · {multiResult.gyro.length>=100?'registrerade':'otillräckliga eller saknas'}</Text>
        <Text style={styles.body}>PCG: {multiResult.audioStatus} · {multiResult.audio.length} ljudenergifönster</Text>
        <Text style={styles.body}>RESP: {summarizeChannel(captured,.1,.5)?.axes.map(a=>a.axis+': '+(a.frequencyHz?.toFixed(2)??'–')+' Hz').join(' · ')??'Otillräckligt underlag'}</Text>
        <Text style={styles.caption}>Experimentella signaler. Ingen verifierad hjärt- eller andningsdiagnostik.</Text>
      </Card>:null}
      {report ? <>
        {scg ? <Card>
          <Text style={styles.heading}>SCG-analys · {measurementMode.current === 'sternum' ? 'Bröstben, ryggläge' : 'Bordskontroll'}</Text>
          <Text style={styles.body}>Kroppsställning: {measurementPosture === 'reclined45' ? 'Halvsittande cirka 45°' : 'Ryggläge'} · Sensorlängd: {captureSeconds.toFixed(2)} s</Text>
          {captureSeconds < 29 ? <Text style={styles.status}>Mätningen är ofullständig. Upprepa för jämförbar personlig analys.</Text> : null}
          <Text style={styles.body}>Bedömning: {scg.quality === 'candidate' ? 'Mekaniskt mönster identifierat – ej verifierat' : scg.quality === 'insufficient' ? 'Störd mätning' : 'Inget säkert återkommande mönster'}</Text>
          <Text style={styles.body}>{scg.explanation}</Text>
          <Text style={styles.body}>Registrerade impulskandidater: {scg.candidateEvents} · Analysaxel: {scg.axis?.toUpperCase() ?? '–'}</Text>
          <Text style={styles.body}>Intervall som uppfyllde algoritmens kriterier: {scg.intervalCoveragePercent === null ? 'Ej beräkningsbart' : `${scg.intervalCoveragePercent.toFixed(1)} %`} · Bortvalda: {scg.rejectedIntervals} (korta: {scg.shortIntervals}, långa: {scg.longIntervals})</Text>
          <Text style={styles.body}>Signalformens samstämmighet inom mätningen: {scg.templateConsistency === null ? 'Kan inte bedömas' : scg.templateConsistency.toFixed(2)} (korrelation −1 till +1; ej medicinskt validerad)</Text>
          <Text style={styles.body}>Mekanisk mall: {scg.eventTemplate ? `${scg.templateEventCount} justerade impulskandidater` : 'Otillräckligt underlag'}</Text>
          <Text style={styles.body}>Filtrerad signal RMS: {scg.signalRms.toFixed(4)} m/s²</Text>
          <Text style={styles.body}>Tidsjitter (medianavvikelse): {scg.timingJitterMs.toFixed(2)} ms · {scg.resampled ? 'Interpolerad till jämna tidssteg' : 'Ej interpolerad'}</Text>
          {scg.artifactWarning ? <Text style={styles.caption}>{scg.artifactWarning}</Text> : null}
          <Text style={styles.body}>Stabilitet mellan mätningens halvor: {scg.windowConsistency ? 'Liknande antal impulser' : 'Ej bekräftad'}</Text>
          <Text style={styles.caption}>Detta är ingen pulsmätning eller hjärtdiagnostik. Impulser kan komma från andning, kontakt eller sensorbrus.</Text>
          <Text style={styles.heading}>Samtidig referenspuls (valfritt)</Text>
          <Text style={styles.body}>Ange uppmätt puls från separat mätare före start för att koppla den till just den mätningen. SCG räknar inte fram puls.</Text>
          <Text style={styles.body}>Referens registrerad vid mätningen: {measuredReference === null ? 'Saknas' : `${measuredReference} slag/min`}</Text>

        </Card> : null}
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
  input: { borderWidth: 1, borderColor: '#a4b5bb', borderRadius: 8, padding: 12, fontSize: 16, color: colors.ink },
  caption: { color: colors.inkMuted, fontSize: 12, lineHeight: 18 },
});
