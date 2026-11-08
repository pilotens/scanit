export type PulseResult = { bpm: number | null; quality: 'usable' | 'insufficient'; sampleCount: number; durationSeconds: number; explanation: string; waveform: number[]; signalScore?: number; stabilityBpm?: number };
type Point = { t: number; value: number };

export function estimateOpticalPulse(points: Point[]): PulseResult {
  const durationSeconds = points.length > 1 ? (points[points.length - 1]!.t - points[0]!.t) / 1000 : 0;
  const base = { sampleCount: points.length, durationSeconds, waveform: [] as number[] };
  const insufficient = (reason: string): PulseResult => ({ ...base, bpm: null, quality: 'insufficient', explanation: reason });
  if (durationSeconds < 18 || points.length < 150) return insufficient('För kort eller ojämn registrering. Håll fingret stilla över kameran i minst 20 sekunder.');
  const intervals = points.slice(1).map((p, i) => p.t - points[i]!.t);
  const medianInterval = [...intervals].sort((a,b)=>a-b)[Math.floor(intervals.length/2)] ?? 0;
  if (medianInterval < 30 || medianInterval > 140 || intervals.filter(x=>x > 250).length > 4) return insufficient('Kameran gav för ojämn bildfrekvens.');
  const start = points[0]!.t, end = points[points.length - 1]!.t;
  const hz = 20, step = 1000 / hz;
  const values: number[] = [];
  let index = 0;
  for (let t = start; t <= end; t += step) {
    while (index < points.length - 2 && points[index + 1]!.t < t) index++;
    const a = points[index]!, b = points[index + 1]!;
    const alpha = Math.max(0, Math.min(1, (t-a.t)/(b.t-a.t || 1)));
    values.push(a.value + (b.value-a.value)*alpha);
  }
  // Local baseline removal suppresses illumination drift and slow finger movement.
  const radius = 20;
  const centered = values.map((v, i) => {
    let sum = 0, count = 0;
    for(let j=Math.max(0,i-radius);j<=Math.min(values.length-1,i+radius);j++){sum+=values[j]!;count++;}
    return v-sum/count;
  });
  const minValue=Math.min(...values), maxValue=Math.max(...values);
  const averageLight=values.reduce((s,v)=>s+v,0)/values.length;
  if(averageLight<20 || averageLight>250 || maxValue-minValue>90) return insufficient('Belysningen är för mörk, överexponerad eller varierar för mycket. Prova en jämn ljuskälla.');
  const rms = Math.sqrt(centered.reduce((s,x)=>s+x*x,0)/centered.length);
  if (rms < 0.15) return insufficient('Ingen tydlig optisk pulssignal. Prova mer ljus och håll fingret helt stilla.');
  const scores: { bpm: number; power: number }[] = [];
  for(let bpm=45;bpm<=180;bpm++){
    const frequency=bpm/60;let real=0,imag=0;
    for(let i=0;i<centered.length;i++){
      const angle=2*Math.PI*frequency*i/hz;
      real+=centered[i]!*Math.cos(angle);imag+=centered[i]!*Math.sin(angle);
    }
    scores.push({bpm,power:(real*real+imag*imag)/(centered.length*centered.length)});
  }
  scores.sort((a,b)=>b.power-a.power);
  const best=scores[0]!;
  const totalPower=centered.reduce((s,v)=>s+v*v,0)/centered.length;
  const strength=2*best.power/(totalPower || 1);
  const competing=scores.filter(s=>Math.abs(s.bpm-best.bpm)>12)[0];
  const separation=best.power/(competing?.power || 1e-9);
  const windowBest = (part:number[]) => {
    let winner={bpm:0,power:0};
    for(let bpm=45;bpm<=180;bpm+=1){
      let re=0,im=0;
      for(let i=0;i<part.length;i++){
        const angle=2*Math.PI*(bpm/60)*i/hz;
        re+=part[i]!*Math.cos(angle);im+=part[i]!*Math.sin(angle);
      }
      const power=(re*re+im*im)/(part.length*part.length);
      if(power>winner.power)winner={bpm,power};
    }
    return winner.bpm;
  };
  const mid=Math.floor(centered.length/2);
  const firstBpm=windowBest(centered.slice(0,mid));
  const secondBpm=windowBest(centered.slice(mid));
  const stabilityBpm=Math.abs(firstBpm-secondBpm);
  const waveform=Array.from({length:60},(_,i)=>centered[Math.min(centered.length-1,Math.floor(i*centered.length/60))]!);
  if(strength<0.18 || separation<1.5 || stabilityBpm>8) return { ...insufficient('Signalen är för brusig eller otydlig för en pulsuppskattning. Försök igen med jämn belysning.'), waveform };
  return { ...base, bpm:best.bpm, quality:'usable', waveform, signalScore:Number(strength.toFixed(2)), stabilityBpm, explanation:'Experimentell uppskattning från ljusvariationer i kameran. Kontrollera mot en riktig pulsmätare. Inte medicinskt validerad.' };
}
