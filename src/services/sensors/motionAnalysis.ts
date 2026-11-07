export type MotionPoint = { t: number; x: number; y: number; z: number };
export type MotionReport = {
  count: number;
  durationSeconds: number;
  samplingHz: number;
  variationRms: number;
  peakDeviation: number;
  quality: 'good' | 'limited' | 'poor';
  qualityText: string;
  interpretation: string;
  segments: number[];
  gaps: number;
  clipped: boolean;
};

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

export function analyzeMotion(points: MotionPoint[]): MotionReport | null {
  if (points.length < 20) return null;
  const ordered = [...points].sort((a, b) => a.t - b.t);
  const durationSeconds = (ordered[ordered.length - 1]!.t - ordered[0]!.t) / 1000;
  if (durationSeconds <= 0) return null;
  // Remove the per-axis DC component so phone orientation does not dominate the result.
  const mx = mean(ordered.map(p => p.x));
  const my = mean(ordered.map(p => p.y));
  const mz = mean(ordered.map(p => p.z));
  const deviations = ordered.map(p => Math.hypot(p.x - mx, p.y - my, p.z - mz));
  const variationRms = Math.sqrt(mean(deviations.map(v => v * v)));
  const peakDeviation = Math.max(...deviations);
  const intervals = ordered.slice(1).map((p, i) => p.t - ordered[i]!.t);
  const gaps = intervals.filter(ms => ms > 200).length;
  const samplingHz = (ordered.length - 1) / durationSeconds;
  const clipped = ordered.some(p => [p.x, p.y, p.z].some(v => !Number.isFinite(v) || Math.abs(v) > 150));
  // Heuristic signal-quality categories only. These are NOT health thresholds.
  const quality: MotionReport['quality'] =
    clipped || samplingHz < 15 || gaps > 3 || durationSeconds < 10 ? 'poor'
    : variationRms > 0.5 || peakDeviation > 3 ? 'limited'
    : 'good';
  const qualityText = quality === 'good' ? 'Stabil mätning'
    : quality === 'limited' ? 'Rörelse stör mätningen'
    : 'Otillräcklig signal';
  const interpretation = quality === 'good'
    ? 'Telefonen var relativt stilla. Små rörelser registrerades, men vi kan inte avgöra om de kommer från hjärta, andning eller andra källor.'
    : quality === 'limited'
    ? 'Telefonen rörde sig tillräckligt mycket för att små vibrationer kan döljas. Prova igen med bättre stöd.'
    : 'Datainsamlingen var ojämn eller för kort. Prova igen och låt skärmen vara aktiv under mätningen.';
  const segments = Array.from({ length: 30 }, (_, i) => {
    const start = Math.floor(i * deviations.length / 30);
    const end = Math.floor((i + 1) * deviations.length / 30);
    return Math.sqrt(mean(deviations.slice(start, Math.max(start + 1, end)).map(v => v * v)));
  });
  return { count: ordered.length, durationSeconds, samplingHz, variationRms, peakDeviation, quality, qualityText, interpretation, segments, gaps, clipped };
}
