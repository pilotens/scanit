import type { MotionPoint } from './motionAnalysis';

export type SpectralBand = { name: string; fromHz: number; toHz: number; peakHz: number | null; strength: number };
export type HarmonicAxisCheck = {
  axis: 'x' | 'y' | 'z';
  fundamentalHz: number | null;
  secondHarmonicHz: number | null;
  frequencyRatio: number | null;
  windowsSupporting: number;
  windowsTested: number;
  status: 'possible' | 'unconfirmed';
  note: string;
};
export type SpectralReport = {
  bands: SpectralBand[];
  windowsAgree: boolean;
  dominantHz: number | null;
  harmonicChecks: HarmonicAxisCheck[];
  harmonicStatus: 'possible' | 'unconfirmed';
  warning: string;
};

function peak(signal:number[], rate:number, low:number, high:number, step=.05) {
  let best={hz:0,power:0};
  if(signal.length<60||rate<=0)return best;
  // Hann window reduces leakage and spurious peaks at search-band edges.
  const mean=signal.reduce((a,b)=>a+b,0)/signal.length;
  for(let hz=low;hz<=high+step/10;hz+=step){
    let re=0,im=0;
    for(let i=0;i<signal.length;i++){
      const w=.5-.5*Math.cos(2*Math.PI*i/(signal.length-1));
      const angle=2*Math.PI*hz*i/rate;
      const v=(signal[i]!-mean)*w;
      re+=v*Math.cos(angle);im+=v*Math.sin(angle);
    }
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
  const axes=['x','y','z'] as const;
  const signals=axes.map(axis=>points.map(p=>p[axis]));
  const bands=[{name:'Långsam rörelse',fromHz:0.1,toHz:0.5},{name:'Periodisk rörelse',fromHz:0.7,toHz:3},{name:'Snabb vibration',fromHz:3,toHz:15}].map(b=>{
    const results=signals.map(s=>peak(s,rate,b.fromHz,b.toHz));
    results.sort((a,b)=>b.power-a.power);
    return {...b,peakHz:results[0]!.power>0?Number(results[0]!.hz.toFixed(2)):null,strength:results[0]!.power};
  });
  const half=Math.floor(points.length/2);
  const first=signals.map(s=>peak(s.slice(0,half),rate,.7,3));
  const second=signals.map(s=>peak(s.slice(half),rate,.7,3));
  const windowsAgree=first.some((a,i)=>Math.abs(a.hz-second[i]!.hz)<.2&&a.power>1e-5&&second[i]!.power>1e-5);

  // Compare both frequency components on the SAME axis in BOTH half-windows.
  // This is a spectral screening test, not proof of common physical origin.
  const harmonicChecks:HarmonicAxisCheck[]=axes.map((axis,i)=>{
    const signal=signals[i]!;
    const halves=[signal.slice(0,half),signal.slice(half)];
    const candidates=halves.map(part=>{
      // 0.7 Hz is the previous search-band boundary. Require an interior
      // fundamental and test its doubled frequency in the same window.
      const f=peak(part,rate,.55,1.5);
      const h=f.hz>0?peak(part,rate,Math.max(1.1,2*f.hz-.16),Math.min(3.1,2*f.hz+.16)):{hz:0,power:0};
      const ratio=f.hz>0?h.hz/f.hz:null;
      const supported=f.hz>=.65&&f.hz<=1.45&&h.power>1e-6&&f.power>1e-6&&
        ratio!==null&&Math.abs(ratio-2)<=.12&&h.power/f.power>=.1;
      return {f,h,ratio,supported};
    });
    const supporting=candidates.filter(v=>v.supported).length;
    const consistent=supporting===2&&Math.abs(candidates[0]!.f.hz-candidates[1]!.f.hz)<=.15;
    const full=peak(signal,rate,.55,1.5);
    const harmonic=peak(signal,rate,Math.max(1.1,2*full.hz-.16),Math.min(3.1,2*full.hz+.16));
    return {
      axis,
      fundamentalHz:full.power>0?Number(full.hz.toFixed(2)):null,
      secondHarmonicHz:harmonic.power>0?Number(harmonic.hz.toFixed(2)):null,
      frequencyRatio:full.hz>0?Number((harmonic.hz/full.hz).toFixed(3)):null,
      windowsSupporting:supporting,
      windowsTested:2,
      status:consistent?'possible':'unconfirmed',
      note:consistent
        ? 'Två frekvenskomponenter nära 2:1 återkommer på samma axel i båda tidsfönstren. Mekaniskt ursprung ej verifierat.'
        : 'Ingen stabil 2:1-relation verifierades på samma axel i båda tidsfönstren.'
    };
  });
  const harmonicStatus=harmonicChecks.some(v=>v.status==='possible')?'possible':'unconfirmed';
  return {
    bands,windowsAgree,dominantHz:bands[1]!.peakHz,harmonicChecks,harmonicStatus,
    warning:'Explorativ frekvensanalys. Harmoniska toppar kan orsakas av rörelse, läckage och filtrering; de är inte bekräftade hjärtslag eller diagnos.'
  };
}
