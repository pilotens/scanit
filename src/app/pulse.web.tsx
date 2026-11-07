import { useEffect, useRef, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { AppButton } from '@/components/AppButton';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { colors } from '@/constants/theme';
import { estimateOpticalPulse, type PulseResult } from '@/services/sensors/opticalPulse';

export default function OpticalPulseScreen() {
  const [status,setStatus]=useState('Redo');
  const [seconds,setSeconds]=useState(0);
  const [result,setResult]=useState<PulseResult|null>(null);
  const stopRef=useRef<()=>void>(()=>{});
  const running=useRef(false);
  const cleanup=useRef<()=>void>(()=>{});
  useEffect(()=>()=>{cleanup.current();},[]);
  const stop=()=>{stopRef.current();};
  const start=async()=>{
    if(running.current)return;
    setResult(null);
    setStatus('Begär kameraåtkomst…');
    let stream:MediaStream|undefined;
    try {
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Kameraåtkomst kräver Safari och HTTPS.');
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:320},height:{ideal:240},frameRate:{ideal:20}}});
      const video=document.createElement('video');
      video.setAttribute('playsinline','true');
      video.muted=true;video.srcObject=stream;
      await video.play();
      const canvas=document.createElement('canvas');canvas.width=24;canvas.height=24;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)throw new Error('Bildanalys stöds inte av webbläsaren.');
      const points:{t:number;value:number}[]=[];
      running.current=true;
      const started=performance.now();
      const tick=window.setInterval(()=>{
        if(video.readyState<2)return;
        ctx.drawImage(video,0,0,24,24);
        const data=ctx.getImageData(0,0,24,24).data;
        let sum=0;
        for(let i=0;i<data.length;i+=4)sum+=data[i]!;
        points.push({t:performance.now(),value:sum/(data.length/4)});
        setSeconds(Math.min(30,Math.floor((performance.now()-started)/1000)));
      },50);
      const finish=()=>{
        if(!running.current)return;
        running.current=false;
        window.clearInterval(tick);window.clearTimeout(timeout);
        stream?.getTracks().forEach(t=>t.stop());
        video.srcObject=null;
        const analysis=estimateOpticalPulse(points);
        setResult(analysis);
        setStatus('Mätningen avslutad');
      };
      const timeout=window.setTimeout(finish,30000);
      stopRef.current=finish;
      cleanup.current=finish;
      setStatus('Mäter ljusvariationer i 30 sekunder. Håll stilla.');
    } catch(error) {
      stream?.getTracks().forEach(t=>t.stop());
      setStatus(error instanceof Error?error.message:'Kameran kunde inte startas');
    }
  };
  return <Screen title="ScanIt · Optisk puls" subtitle="Experimentell pulsmätning med iPhone-kamera">
    <Card>
      <Text style={styles.heading}>Mät puls med kameran</Text>
      <Text style={styles.body}>Placera fingertoppen varsamt över den bakre kameran utan att trycka hårt. Se till att det finns tillräckligt med ljus. Håll fingret helt stilla i 30 sekunder. Safari kan inte garantera att kamerablixten kan aktiveras.</Text>
      <Text style={styles.body}>Mätningen sker lokalt i webbläsaren. Kamerabilder sparas eller laddas inte upp.</Text>
      <Text style={styles.status}>{status}</Text>
      {running.current?<Text style={styles.heading}>{seconds} / 30 sekunder</Text>:null}
      <AppButton label="Starta kameramätning" onPress={start}/>
      <AppButton label="Avbryt mätning" secondary onPress={stop}/>
    </Card>
    {result?<Card>
      <Text style={styles.heading}>Din optiska pulssignal</Text>
      <Text style={styles.value}>{result.bpm===null?'Ingen säker uppskattning':`${result.bpm} slag/min`}</Text>
      <Text style={styles.body}>{result.explanation}</Text>
      <Text style={styles.body}>Insamling: {result.durationSeconds.toFixed(1)} sekunder, {result.sampleCount} kameramätningar.</Text>
      <Text style={styles.body}>Detta är ett experimentellt test, inte en medicinsk mätning eller ett EKG.</Text>
    </Card>:null}
    <AppButton label="Mät rörelse med accelerometern" secondary onPress={()=>router.push('/phone-sensors')}/>
  </Screen>;
}
const styles=StyleSheet.create({
 heading:{fontSize:18,fontWeight:'700',color:colors.ink},
 body:{fontSize:14,lineHeight:21,color:colors.inkMuted},
 status:{fontSize:15,fontWeight:'700',color:colors.primary},
 value:{fontSize:27,fontWeight:'800',color:colors.primary},
});
