import type { MotionPoint } from './motionAnalysis';

export type SpectralBand = { name: string; fromHz: number; toHz: number; peakHz: number | null; strength: number };
export type SpectralReport = { bands: SpectralBand[]; windowsAgree: boolean; dominantHz: number | null; warning: string };

function peak(signal:number[], rate:number, low:number, high:number){
  let best={hz:0,power:0};
  for(let hz=low;hz<=high;hz+=0.1){
    let re=0,im=0;
    for(let i=0;i<signal.length;i++){const angle=2*Math.PI*hz*i/rate;re+=signal[i]!*Math.cos(angle);im+=signal[i]!*Math.sin(angle);}
    const power=(re*re+im*im)/(signal.length*signal.length);
    if(power>best.power)best={hz,power};
  }
  return best;
}
export function analyzeMotionSpectrum(points:MotionPoint[]):SpectralReport|null{
  if(points.length<300)return null;
  const duration=(points[points.length-1]!.t-points[0]!.t)/1000;
  const rate=(points.length-1)/duration;
  if(rate<30)return null;
  const averages=['x','y','z'].map(axis=>points.reduce((s,p)=>s+p[axis as 'x'|'y'|'z'],0)/points.length);
  const signals=[0,1,2].map((axis)=>points.map(p=>p[['x','y','z'][axis] as 'x'|'y'|'z']-averages[axis]!));
  const bands=[{name:'Långsam rörelse',fromHz:0.1,toHz:0.5},{name:'Periodisk rörelse',fromHz:0.7,toHz:3},{name:'Snabb vibration',fromHz:3,toHz:15}].map(b=>{
    const results=signals.map(s=>peak(s,rate,b.fromHz,b.toHz));
    results.sort((a,b)=>b.power-a.power);
    return {...b,peakHz:results[0]!.power>0?Number(results[0]!.hz.toFixed(2)):null,strength:results[0]!.power};
  });
  const half=Math.floor(points.length/2);
  const a=peak(signals[2]!.slice(0,half),rate,.7,3);
  const b=peak(signals[2]!.slice(half),rate,.7,3);
  const windowsAgree=Math.abs(a.hz-b.hz)<.2 && a.power>0.00001 && b.power>0.00001;
  return {bands,windowsAgree,dominantHz:bands[1]!.peakHz,warning:'Spektrala toppar är rörelsefrekvenser, inte bekräftade hjärtslag eller andning. Jämför med samtidig referensmätning.'};
}
