import type { MotionReport } from './motionAnalysis';
import type { SpectralReport } from './motionSpectrum';
import type { ScgReport } from './scgAnalysis';
import type { RepeatSummary } from './scgRepeatability';

type ChannelSummary = {
  durationSeconds: number;
  count: number;
  axes: { axis: 'x' | 'y' | 'z'; rms: number; frequencyHz: number | null; power: number }[];
  origin: string;
  gaps: number;
};

type ChannelComparison = {
  accAxis: 'x' | 'y' | 'z';
  gyroAxis: 'x' | 'y' | 'z';
  lagMs: number;
  trainingCorrelation: number;
  validationCorrelation: number | null;
  validationPairs: number;
  repeatable: boolean;
};

type CrossAnalysis = {
  overlapSeconds: number;
  gridHz: number;
  pairedCoverage: number;
  mechanical: ChannelComparison | null;
  respiratory: ChannelComparison | null;
  scgCandidateHz: number | null;
  frequencyDifferences: { axis: 'x' | 'y' | 'z'; frequencyHz: number | null; differenceHz: number | null }[];
  warning: string;
};

/** The analysis fields shared by compact clipboard output and the full export.
 * Raw rows and history records need not be constructed to create the summary.
 */
export type MeasurementExportInput = {
  source: string;
  timestamp: string;
  measurement: string;
  units: string;
  caution: string;
  note?: string;
  summary: MotionReport;
  sensorSource: string;
  requestedSensorHz: number | null;
  protocol: {
    mode: string;
    position: string;
    referenceBpm: number | null;
    capturedDurationSeconds: number;
    completeCapture: boolean;
  };
  exploratorySpectrum: SpectralReport | null;
  exploratoryScg: ScgReport | null;
  multimodal: {
    clock: string;
    accelerationStartMs: number;
    gcg: {
      units: string;
      analysis: ChannelSummary | null;
      sampleCount?: number;
      samples?: readonly unknown[];
    };
    resp: {
      acceleration: ChannelSummary | null;
      rotation: ChannelSummary | null;
      warning: string;
    };
    crossAnalysis: CrossAnalysis | null;
  } | null;
  pairedControl: Partial<Record<'sternum' | 'table', { motion: MotionReport; spectrum: SpectralReport | null }>>;
  repeatability: RepeatSummary | null;
  historyCount?: number;
  personalHistory?: readonly unknown[];
};

function motionSummary(report: MotionReport) {
  return {
    count: report.count,
    durationSeconds: report.durationSeconds,
    samplingHz: report.samplingHz,
    variationRms: report.variationRms,
    peakDeviation: report.peakDeviation,
    quality: report.quality,
    qualityText: report.qualityText,
    interpretation: report.interpretation,
    gaps: report.gaps,
    clipped: report.clipped,
  };
}

function channelSummary(channel: ChannelSummary | null) {
  if (!channel) return null;
  return {
    count: channel.count,
    durationSeconds: channel.durationSeconds,
    samplingHz: channel.durationSeconds > 0 ? (channel.count - 1) / channel.durationSeconds : null,
    gaps: channel.gaps,
    origin: channel.origin,
    axes: channel.axes.map(axis => ({
      axis: axis.axis,
      rms: axis.rms,
      frequencyHz: axis.frequencyHz,
      power: axis.power,
    })),
  };
}

function comparisonSummary(comparison: ChannelComparison | null) {
  if (!comparison) return null;
  return {
    accAxis: comparison.accAxis,
    gyroAxis: comparison.gyroAxis,
    lagMs: comparison.lagMs,
    trainingCorrelation: comparison.trainingCorrelation,
    validationCorrelation: comparison.validationCorrelation,
    validationPairs: comparison.validationPairs,
    repeatable: comparison.repeatable,
  };
}

/** Select a fixed set of analysis fields; never walk or serialize raw/history
 * records. This is a shareable overview, not a replacement for the full file.
 */
export function serializeCompactMeasurement(payload: MeasurementExportInput): string {
  const scg = payload.exploratoryScg;
  const spectrum = payload.exploratorySpectrum;
  const multimodal = payload.multimodal;
  const cross = multimodal?.crossAnalysis;
  const repeat = payload.repeatability;
  const controlSummary = (control: MeasurementExportInput['pairedControl']['sternum']) => control ? {
    count: control.motion.count,
    durationSeconds: control.motion.durationSeconds,
    quality: control.motion.quality,
    variationRms: control.motion.variationRms,
    gaps: control.motion.gaps,
    clipped: control.motion.clipped,
    dominantHz: control.spectrum?.dominantHz ?? null,
    windowsAgree: control.spectrum?.windowsAgree ?? null,
  } : null;

  const summary = {
    schema: 'scanit.measurement-summary',
    schemaVersion: 1,
    exportType: 'compact_summary',
    source: payload.source,
    timestamp: payload.timestamp,
    note: payload.note?.slice(0, 160),
    measurement: payload.measurement,
    units: payload.units,
    caution: payload.caution,
    detail: {
      rawSamplesIncluded: false,
      historyRecordsIncluded: false,
      numericPrecision: '6 significant digits; summary only',
      forDetailedAnalysis: 'Attach the full JSON file for exact-time, transient, waveform or independent reanalysis. This summary cannot resolve an event at a specific second.',
    },
    protocol: {
      mode: payload.protocol.mode,
      position: payload.protocol.position,
      referenceBpm: payload.protocol.referenceBpm,
      capturedDurationSeconds: payload.protocol.capturedDurationSeconds,
      completeCapture: payload.protocol.completeCapture,
    },
    sensorSource: payload.sensorSource,
    requestedSensorHz: payload.requestedSensorHz,
    summary: motionSummary(payload.summary),
    exploratoryScg: scg ? {
      quality: scg.quality,
      explanation: scg.explanation,
      signalOrigin: scg.signalOrigin,
      sampleRateHz: scg.sampleRateHz,
      axis: scg.axis,
      candidateEvents: scg.candidateEvents,
      medianIntervalMs: scg.medianIntervalMs,
      intervalVariationPercent: scg.intervalVariationPercent,
      intervalCoveragePercent: scg.intervalCoveragePercent,
      rejectedIntervals: scg.rejectedIntervals,
      shortIntervals: scg.shortIntervals,
      longIntervals: scg.longIntervals,
      dataGapCount: scg.dataGaps.length,
      windowConsistency: scg.windowConsistency,
      artifactFraction: scg.artifactFraction,
      artifactWarning: scg.artifactWarning,
      baselineRms: scg.baselineRms,
      signalRms: scg.signalRms,
      timingJitterMs: scg.timingJitterMs,
      resampled: scg.resampled,
      templateEventCount: scg.templateEventCount,
      templateConsistency: scg.templateConsistency,
    } : null,
    exploratorySpectrum: spectrum ? {
      bands: spectrum.bands.map(band => ({
        name: band.name,
        fromHz: band.fromHz,
        toHz: band.toHz,
        peakHz: band.peakHz,
        strength: band.strength,
      })),
      dominantHz: spectrum.dominantHz,
      windowsAgree: spectrum.windowsAgree,
      harmonicStatus: spectrum.harmonicStatus,
      warning: spectrum.warning,
    } : null,
    multimodal: multimodal ? {
      clock: multimodal.clock,
      accelerationStartMs: multimodal.accelerationStartMs,
      gcg: {
        units: multimodal.gcg.units,
        sampleCount: multimodal.gcg.sampleCount ?? multimodal.gcg.samples?.length ?? multimodal.gcg.analysis?.count ?? null,
        analysis: channelSummary(multimodal.gcg.analysis),
      },
      resp: {
        acceleration: channelSummary(multimodal.resp.acceleration),
        rotation: channelSummary(multimodal.resp.rotation),
        warning: multimodal.resp.warning,
      },
      crossAnalysis: cross ? {
        overlapSeconds: cross.overlapSeconds,
        gridHz: cross.gridHz,
        pairedCoverage: cross.pairedCoverage,
        mechanical: comparisonSummary(cross.mechanical),
        respiratory: comparisonSummary(cross.respiratory),
        scgCandidateHz: cross.scgCandidateHz,
        frequencyDifferences: cross.frequencyDifferences.map(item => ({
          axis: item.axis,
          frequencyHz: item.frequencyHz,
          differenceHz: item.differenceHz,
        })),
        warning: cross.warning,
      } : null,
    } : null,
    pairedControl: {
      sternum: controlSummary(payload.pairedControl.sternum),
      table: controlSummary(payload.pairedControl.table),
    },
    repeatability: repeat ? {
      count: repeat.count,
      rmsRangePercent: repeat.rmsRangePercent,
      medianIntervalRangePercent: repeat.medianIntervalRangePercent,
      waveformSimilarity: repeat.waveformSimilarity,
      templateSimilarity: repeat.templateSimilarity,
      templatePairs: repeat.templatePairs,
      conclusion: repeat.conclusion,
    } : null,
    historyCount: payload.historyCount ?? payload.personalHistory?.length ?? 0,
    analysis_request: 'Describe signal quality and exploratory mechanical patterns in SCG, GCG and RESP. Preserve uncertainty and missing data. Do not infer ECG, verified heart/respiratory rate, diagnosis or health status. Request the full JSON for individual-event analysis.',
  };

  // Significant figures retain tiny nonzero spectral powers; fixed decimal
  // rounding would silently turn them into zero. This never changes input data.
  return JSON.stringify(summary, (_key, value: unknown) => typeof value === 'number'
    ? Number.isFinite(value) ? Number(value.toPrecision(6)) : null
    : value);
}
