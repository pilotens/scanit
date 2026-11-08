import { useEffect, useRef, useState } from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { colors } from '@/constants/theme';
import { analyzeBreathing, type BreathingReport, type BreathingPoint } from '@/services/sensors/breathingAnalysis';

export default function BreathingScreen(){
 const [status,setStatus]=useState('Redo att mäta');
 const [elapsed,setElapsed]=useState(0);
 const [running,setRunning]=useState(false);
 const [report,setReport]=useState<BreathingReport|null>(null);
 const stopRef=useRef<()=>void>(()=>{});
 const cleanup=useRef<()=>void>(()=>{});
 useEffect(()=>()=>cleanup.current(),[]);
 const start=async()=>{
  setReport(null);setElapsed(0);
  let stream:MediaStream|undefined;let context:AudioContext|undefined;
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw new Error('Mikrofon kräver Safari via HTTPS.');
   stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
   context=new AudioContext();await context.resume();
   const source=context.createMediaStreamSource(stream);
   const analyser=context.createAnalyser();analyser.fftSize=2048;
   source.connect(analyser);
   const samples=new Float32Array(analyser.fftSize);
   const points:BreathingPoint[]=[];
   const started=performance.now();
   let active=true;
   const tick=window.setInterval(()=>{
    if(!active)return;
    analyser.getFloatTimeDomainData(samples);
    let sum=0;
    for(const sample of samples)sum+=sample*sample;
    points.push({t:performance.now(),amplitude:Math.sqrt(sum/samples.length)});
    setElapsed(Math.min(40,Math.floor((performance.now()-started)/1000)));
   },100);
   const finish=()=>{
    if(!active)return;active=false;
    window.clearInterval(tick);window.clearTimeout(timeout);
    stream?.getTracks().forEach(track=>track.stop());
    void context?.close();
    setRunning(false);
    setReport(analyzeBreathing(points));
    setStatus('Mätning klar');
   };
   const timeout=window.setTimeout(finish,40000);
   stopRef.current=finish;cleanup.current=finish;
   setRunning(true);setStatus('Lyssnar efter återkommande andningsljud…');
  }catch(e){
   stream?.getTracks().forEach(track=>track.stop());
   if(context)void context.close();
   setRunning(false);setStatus(e instanceof Error?e.message:'Mikrofonen kunde inte starta');
  }
 };
 return <Screen title="ScanIt · Andning" subtitle="Verklig ljudmätning med iPhone-mikrofon">
  <Card>
   <Text style={styles.heading}>Undersök din andningsrytm</Text>
   <Text style={styles.body}>Sitt stilla i ett tyst rum. Håll mikrofonen nära munnen eller näsan, utan att täcka den. Andas normalt i 40 sekunder. Prata inte under mätningen.</Text>
   <Text style={styles.body}>Ljud analyseras lokalt i webbläsaren och spelas inte in eller laddas upp.</Text>
   <Text style={styles.status}>{status}</Text>
   {running?<Text style={styles.value}>{elapsed} / 40 s</Text>:null}
   <AppButton label="Starta andningsmätning" onPress={start}/>
   <AppButton label="Stoppa" secondary onPress={()=>stopRef.current()}/>
  </Card>
  {report?<Card>
   <Text style={styles.heading}>Andningsanalys</Text>
   <Text style={styles.value}>{report.breathsPerMinute===null?'Ingen tillförlitlig uppskattning':`${report.breathsPerMinute} andetag/min`}</Text>
   <Text style={styles.body}>{report.explanation}</Text>
   <View style={styles.chart}>
    {report.envelope.map((value,i)=>{const max=Math.max(.01,...report.envelope);return <View key={i} style={[styles.bar,{height:Math.max(3,Math.min(76,value/max*76))}]}/>;})}
   </View>
   <Text style={styles.body}>Ljudstyrka över tid. Högre staplar betyder starkare ljud, inte nödvändigtvis ett andetag.</Text>
   <Text style={styles.body}>Detta är ett experimentellt test och ersätter inte medicinsk bedömning.</Text>
  </Card>:null}
  <AppButton label="Mät puls med kameran" secondary onPress={()=>router.push('/pulse')}/>
 </Screen>;
}
const styles=StyleSheet.create({
 heading:{fontSize:17,fontWeight:'700',color:colors.ink},
 body:{fontSize:14,lineHeight:21,color:colors.inkMuted},
 status:{fontSize:15,fontWeight:'700',color:colors.primary},
 value:{fontSize:25,fontWeight:'800',color:colors.primary},
 chart:{height:90,flexDirection:'row',alignItems:'flex-end',gap:2},
 bar:{flex:1,backgroundColor:colors.primary,borderRadius:2},
});
