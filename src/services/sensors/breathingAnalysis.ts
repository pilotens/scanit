export type BreathingPoint = { t: number; amplitude: number };
export type BreathingReport = {
  breathsPerMinute: number | null;
  quality: 'usable' | 'insufficient';
  explanation: string;
  durationSeconds: number;
  envelope: number[];
  candidateBreaths: number;
};

export function analyzeBreathing(points: BreathingPoint[]): BreathingReport {
  const durationSeconds = points.length > 1 ? (points[points.length - 1]!.t - points[0]!.t) / 1000 : 0;
  const envelope = points.map(p => p.amplitude);
  const base = { durationSeconds, envelope: envelope.filter((_,i)=>i%Math.max(1,Math.ceil(envelope.length/60))===0).slice(0,60) };
  const fail = (explanation:string, candidateBreaths=0):BreathingReport=>({ ...base, breathsPerMinute:null, quality:'insufficient', explanation, candidateBreaths });
  if(durationSeconds<25 || points.length<50) return fail('För kort ljudregistrering. Försök mäta i minst 30 sekunder.');
  const dt=durationSeconds/(points.length-1);
  if(dt>0.25) return fail('Ljudsamplingen var för ojämn för att analysera andningsmönster.');
  const smoothed=envelope.map((_,i)=>{
    const radius=Math.max(1,Math.round(0.5/dt));let sum=0,n=0;
    for(let j=Math.max(0,i-radius);j<=Math.min(envelope.length-1,i+radius);j++){sum+=envelope[j]!;n++;}
    return sum/n;
  });
  const sorted=[...smoothed].sort((a,b)=>a-b);
  const p20=sorted[Math.floor(sorted.length*.2)]??0;
  const p80=sorted[Math.floor(sorted.length*.8)]??0;
  if(p80-p20<0.003) return fail('För lite variation i ljudet för att särskilja andetag från bakgrundsljud.');
  const threshold=p20+(p80-p20)*0.55;
  const peaks:number[]=[];
  const minGap=Math.round(1.8/dt);
  for(let i=1;i<smoothed.length-1;i++){
    if(smoothed[i]!<threshold || smoothed[i]!<smoothed[i-1]! || smoothed[i]!<=smoothed[i+1]!)continue;
    if(peaks.length && i-peaks[peaks.length-1]!<minGap){
      if(smoothed[i]!>smoothed[peaks[peaks.length-1]!]!)peaks[peaks.length-1]=i;
    }else peaks.push(i);
  }
  if(peaks.length<5) return fail('För få tydliga andningsljud. Prova en tystare miljö och håll mikrofonen nära mun eller näsa.',peaks.length);
  const gaps=peaks.slice(1).map((p,i)=>(p-peaks[i]!)*dt);
  const sortedGaps=[...gaps].sort((a,b)=>a-b);
  const median=sortedGaps[Math.floor(sortedGaps.length/2)]!;
  const outliers=gaps.filter(x=>Math.abs(x-median)>median*.35).length;
  const bpm=60/median;
  if(outliers>gaps.length*.25 || bpm<6 || bpm>35) return fail('Andningsljuden var för oregelbundna för en säker uppskattning.',peaks.length);
  return { ...base, breathsPerMinute:Math.round(bpm), quality:'usable', candidateBreaths:peaks.length, explanation:'Experimentell uppskattning från återkommande ljudtoppar. Tal, vind, hosta och bakgrundsljud kan ge fel värde. Inte medicinskt validerad.' };
}
