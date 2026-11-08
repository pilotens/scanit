import { useMemo } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import type { MotionPoint } from '@/services/sensors/motionAnalysis';

type Axis = 'x' | 'y' | 'z';
const axes: { key: Axis; color: string; label: string }[] = [
  { key: 'x', color: '#22c55e', label: 'X' },
  { key: 'y', color: '#38bdf8', label: 'Y' },
  { key: 'z', color: '#f59e0b', label: 'Z' },
];
const W = 600, H = 190, PAD = 18;

export function MotionWaveform({ samples }: { samples: MotionPoint[] }) {
  const chart = useMemo(() => {
    if (samples.length < 2) return null;
    const start = samples[0]!.t, duration = Math.max(1, samples[samples.length-1]!.t - start);
    const means = axes.map(a => samples.reduce((s,p)=>s+p[a.key],0)/samples.length);
    const centered = samples.map(p => axes.map((a,i)=>p[a.key]-means[i]!));
    const sorted = centered.flat().map(Math.abs).sort((a,b)=>a-b);
    const limit = Math.max(0.03, sorted[Math.floor(sorted.length*.99)] ?? 0.03);
    const step = Math.max(1,Math.ceil(samples.length/300));
    const paths = axes.map((axis,idx) => {
      const pieces:string[] = [];
      for(let i=0;i<samples.length;i+=step){
        const x=PAD+(samples[i]!.t-start)/duration*(W-2*PAD);
        const y=H/2-Math.max(-1,Math.min(1,centered[i]![idx]!/limit))*(H/2-PAD);
        pieces.push(`${pieces.length?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`);
      }
      return { ...axis, d:pieces.join(' ') };
    });
    return { paths, limit, seconds:duration/1000 };
  }, [samples]);
  if (!chart) return null;
  return <View>
    <Text style={styles.title}>Accelerationskurvor · X / Y / Z</Text>
    <View style={styles.legend}>{axes.map(a=><View key={a.key} style={styles.legendItem}><View style={[styles.dot,{backgroundColor:a.color}]}/><Text style={styles.legendText}>{a.label}</Text></View>)}</View>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Tre accelerationskurvor över mätningens tid. Kurvorna är relativt respektive axels medelvärde, inte EKG.">
      <rect x="0" y="0" width={W} height={H} fill="#071b23" rx="8"/>
      {Array.from({length:5},(_,i)=><line key={i} x1={PAD} x2={W-PAD} y1={PAD+i*(H-2*PAD)/4} y2={PAD+i*(H-2*PAD)/4} stroke="#254451" strokeWidth="1"/>)}
      <line x1={PAD} x2={W-PAD} y1={H/2} y2={H/2} stroke="#66838d" strokeWidth="1"/>
      {chart.paths.map(p=><path key={p.key} d={p.d} stroke={p.color} fill="none" strokeWidth="1.5" strokeLinejoin="round"/>)}
    </svg>
    <View style={styles.axis}><Text style={styles.legendText}>0 s</Text><Text style={styles.legendText}>{(chart.seconds/2).toFixed(0)} s</Text><Text style={styles.legendText}>{chart.seconds.toFixed(0)} s</Text></View>
    <Text style={styles.note}>Visar verklig accelerationssignal, centrerad per axel. Skalan är ±{chart.limit.toFixed(3)} m/s² (99:e percentilen). Detta är inte ett EKG och identifierar inte hjärtslag.</Text>
  </View>;
}
const styles=StyleSheet.create({
 title:{fontSize:16,fontWeight:'700',color:'#17333d',marginBottom:8},
 legend:{flexDirection:'row',gap:14,marginBottom:8},
 legendItem:{flexDirection:'row',alignItems:'center',gap:5},
 dot:{width:9,height:9,borderRadius:5},
 legendText:{fontSize:12,color:'#6c8188'},
 axis:{flexDirection:'row',justifyContent:'space-between'},
 note:{fontSize:12,lineHeight:18,color:'#6c8188',marginTop:8},
});
