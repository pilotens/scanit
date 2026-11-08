import type { MotionPoint } from './motionAnalysis';

export type ScgReport = {
  quality: 'candidate' | 'unconfirmed' | 'insufficient';
  explanation: string;
  sampleRateHz: number;
  candidateEvents: number;
  medianIntervalMs: number | null;
  intervalVariationPercent: number | null;
  windowConsistency: boolean;
  artifactFraction: number;
  axis: 'x' | 'y' | 'z' | null;
  filteredWaveform: number[];
  intervalCoveragePercent: number | null;
  rejectedIntervals: number;
  shortIntervals: number;
  longIntervals: number;
  baselineRms: number;
  signalRms: number;
  artifactWarning: string | null;
  timingJitterMs: number;
  resampled: boolean;
  eventTemplate: number[] | null;
  templateEventCount: number;
  templateConsistency: number | null;
  signalOrigin: 'unverified_mechanical';
};

function median(v:number[]):number {
  if(!v.length)return 0;
  const sorted=[...v].sort((a,b)=>a-b);
  return sorted[Math.floor(sorted.length/2)]!;
}
function bandpass(input:number[],fs:number,low:number,high:number){
  // Cascaded one-pole high-pass and low-pass; exploratory, not a clinical filter.
  const dt=1/fs, rcHigh=1/(2*Math.PI*low), rcLow=1/(2*Math.PI*high);
  const alphaHigh=rcHigh/(rcHigh+dt), alphaLow=dt/(rcLow+dt);
  const output:number[]=[];let hp=0,lp=0,prev=input[0]??0;
  for(const x of input){hp=alphaHigh*(hp+x-prev);prev=x;lp+=alphaLow*(hp-lp);output.push(lp);}
  return output;
}
export function analyzeScg(points:MotionPoint[]):ScgReport|null{
  if(points.length<300)return null;
  const duration=(points[points.length-1]!.t-points[0]!.t)/1000;
  if(duration<15)return null;
  const fs=(points.length-1)/duration;
  if(fs<35)return null;
  const intervals=points.slice(1).map((p,i)=>p.t-points[i]!.t);
  const gapFraction=intervals.filter(v=>v>50||v<5).length/intervals.length;
  const nominalStep=1000/fs;
  const timingJitterMs=median(intervals.map(v=>Math.abs(v-nominalStep)));
  // Interpolate all axes onto a uniform timeline before filtering. Original timestamps
  // remain the source of truth for event intervals and are reconstructed below.
  const start=points[0]!.t;
  const uniform=Array.from({length:points.length},(_,i)=>{
    const t=start+i*nominalStep;
    return {t,x:0,y:0,z:0};
  });
  let cursor=0;
  for(const p of uniform){
    while(cursor<points.length-2 && points[cursor+1]!.t<p.t)cursor++;
    const a=points[cursor]!,b=points[cursor+1]!;
    const weight=Math.max(0,Math.min(1,(p.t-a.t)/Math.max(1e-9,b.t-a.t)));
    p.x=a.x+(b.x-a.x)*weight;
    p.y=a.y+(b.y-a.y)*weight;
    p.z=a.z+(b.z-a.z)*weight;
  }
  const axes=(['x','y','z'] as const).map(axis=>{
    const values=uniform.map(p=>p[axis]);
    const filtered=bandpass(values,fs,.8,20);
    const rms=Math.sqrt(filtered.reduce((s,v)=>s+v*v,0)/filtered.length);
    return {axis,filtered,rms};
  }).sort((a,b)=>b.rms-a.rms);
  const chosen=axes[0]!;
  const signal=chosen.filtered;
  // Detect large local energy excursions, not ECG R-peaks or verified cardiac events.
  const envelope=signal.map(v=>Math.abs(v));
  const threshold=Math.max(.018,median(envelope)*3);
  const minDistance=Math.round(fs*.35);
  const events:number[]=[];
  for(let i=2;i<envelope.length-2;i++){
    if(envelope[i]!<threshold || envelope[i]!<=envelope[i-1]! || envelope[i]!<envelope[i+1]!)continue;
    if(events.length && i-events[events.length-1]!<minDistance){
      const last=events[events.length-1]!;
      if(envelope[i]!>envelope[last]!)events[events.length-1]=i;
    }else events.push(i);
  }
  const diffs=events.slice(1).map((v,i)=>((v-events[i]!)*nominalStep));
  const plausible=diffs.filter(v=>v>=350&&v<=1500);
  const shortIntervals=diffs.filter(v=>v<350).length;
  const longIntervals=diffs.filter(v=>v>1500).length;
  const intervalCoveragePercent=diffs.length?100*plausible.length/diffs.length:null;
  const med=median(plausible);
  const mad=median(plausible.map(v=>Math.abs(v-med)));
  const variation=med>0?100*mad/med:null;
  const half=points.length/2;
  const left=events.filter(v=>v<half).length;
  const right=events.filter(v=>v>=half).length;
  const windowConsistency=left>=5&&right>=5&&Math.abs(left-right)/Math.max(left,right)<.3;
  const artifactFraction=envelope.filter(v=>v>Math.max(.3,threshold*6)).length/envelope.length;
  // Median waveform aligned to detected mechanical impulse candidates.
  // 150 ms before and 350 ms after each event, sampled at 60 Hz.
  const offsets=Array.from({length:31},(_,i)=>(i-9)/60);
  const snippets=events.filter(index=>index>=Math.ceil(fs*.15)&&index+Math.ceil(fs*.35)<signal.length).map(index=>{
    return offsets.map(offset=>{
      const at=index+offset*fs, lo=Math.floor(at),hi=Math.min(signal.length-1,lo+1);
      return signal[lo]!+(signal[hi]!-signal[lo]!)*(at-lo);
    });
  });
  const eventTemplate=snippets.length>=8?offsets.map((_,i)=>Number(median(snippets.map(row=>row[i]!)).toFixed(5))):null;
  // A median template alone can conceal disagreement among events.
  // Score individual centered snippets against the median morphology.
  const templateConsistency=eventTemplate&&snippets.length>=8?(()=>{
    const centered=(v:number[])=>{const avg=v.reduce((a,b)=>a+b,0)/v.length;return v.map(x=>x-avg);};
    const template=centered(eventTemplate);
    const templateEnergy=Math.sqrt(template.reduce((sum,v)=>sum+v*v,0));
    if(templateEnergy<1e-8)return null;
    const scores=snippets.map(row=>{
      const centeredRow=centered(row);
      const energy=Math.sqrt(centeredRow.reduce((sum,v)=>sum+v*v,0));
      if(energy<1e-8)return null;
      return centeredRow.reduce((sum,v,i)=>sum+v*template[i]!,0)/(energy*templateEnergy);
    }).filter((v):v is number=>v!==null);
    return scores.length>=8?median(scores):null;
  })():null;
  const candidate=events.length>=15 && plausible.length>=events.length*.85 &&
    variation!==null&&variation<18&&windowConsistency&&artifactFraction<.08&&gapFraction<.02;
  const quality:ScgReport['quality']=gapFraction>.03||artifactFraction>.15?'insufficient':candidate?'candidate':'unconfirmed';
  return {
    quality,
    explanation:quality==='candidate'
      ? 'Återkommande mekaniska impulser upptäcktes. De är INTE bekräftade hjärtslag. Kontrollera mot samtidig EKG- eller pulsmätning.'
      : quality==='insufficient'
      ? 'Rörelseartefakter eller tidsavvikelser begränsar analysen. Prova med telefonen stilla på bröstbenet.'
      : 'Mekaniska impulser kunde inte identifieras konsekvent. Ingen fysiologisk rytm kan rapporteras.',
    sampleRateHz:fs,candidateEvents:events.length,medianIntervalMs:plausible.length>=8?med:null,
    intervalVariationPercent:plausible.length>=8?variation:null,windowConsistency,artifactFraction,
    intervalCoveragePercent,rejectedIntervals:diffs.length-plausible.length,shortIntervals,longIntervals,
    timingJitterMs,resampled:true,
    baselineRms:Math.sqrt(points.reduce((sum,p)=>sum+(p.x*p.x+p.y*p.y+p.z*p.z),0)/points.length),
    signalRms:chosen.rms,
    artifactWarning:intervalCoveragePercent!==null&&intervalCoveragePercent<85
      ? 'Många kandidatintervall föll utanför analysintervallet. Rapporterad intervallvariation kan därför underskatta den verkliga spridningen.'
      : null,
    eventTemplate,templateEventCount:snippets.length,templateConsistency,signalOrigin:'unverified_mechanical',
    axis:chosen.axis,
    filteredWaveform:Array.from({length:180},(_,i)=>Number(signal[Math.min(signal.length-1,Math.floor(i*signal.length/180))]!.toFixed(5)))
  };
}
