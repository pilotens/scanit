import type { ScgReport } from './scgAnalysis';
export type RepeatSummary = {
  count:number; rmsRangePercent:number; medianIntervalRangePercent:number|null;
  waveformSimilarity:number|null; conclusion:string;
};
export type RepeatEntry = {rms:number; scg:ScgReport|null};
function correlation(a:number[],b:number[]):number|null{
  if(a.length!==b.length||a.length<20)return null;
  const ma=a.reduce((s,v)=>s+v,0)/a.length,mb=b.reduce((s,v)=>s+v,0)/b.length;
  let xy=0,xx=0,yy=0;
  for(let i=0;i<a.length;i++){const x=a[i]!-ma,y=b[i]!-mb;xy+=x*y;xx+=x*x;yy+=y*y;}
  return xx>1e-12&&yy>1e-12?xy/Math.sqrt(xx*yy):null;
}
export function summarizeRepeats(entries:RepeatEntry[]):RepeatSummary|null{
  if(entries.length<2)return null;
  const rms=entries.map(e=>e.rms),mean=rms.reduce((s,v)=>s+v,0)/rms.length;
  const rmsRangePercent=mean>0?100*(Math.max(...rms)-Math.min(...rms))/mean:0;
  const intervals=entries.map(e=>e.scg?.medianIntervalMs).filter((x):x is number=>x!=null);
  const medianIntervalRangePercent=intervals.length===entries.length?100*(Math.max(...intervals)-Math.min(...intervals))/(intervals.reduce((s,v)=>s+v,0)/intervals.length):null;
  // The 180-point waveform is an absolute-time trace; correlation is phase sensitive.
  // Low correlation is not evidence of abnormal physiology.
  const scores:number[]=[];
  for(let i=1;i<entries.length;i++){
    const a=entries[i-1]!.scg?.filteredWaveform,b=entries[i]!.scg?.filteredWaveform;
    if(a&&b){const score=correlation(a,b);if(score!==null)scores.push(score);}
  }
  const waveformSimilarity=scores.length?scores.reduce((s,v)=>s+v,0)/scores.length:null;
  return {count:entries.length,rmsRangePercent,medianIntervalRangePercent,waveformSimilarity,
    conclusion:'Jämförelsen beskriver upprepbarhet av mekaniska signaler, inte hjärtrytm eller hälsostatus. Kurvkorrelation påverkas starkt av tidsförskjutning och placering.'};
}
