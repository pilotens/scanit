// Node 22.13+ runs the real TypeScript helper with --experimental-strip-types.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeMotion } from '../src/services/sensors/motionAnalysis.ts';
import { serializeCompactMeasurement } from '../src/services/sensors/measurementExport.ts';

const axes = ['x', 'y', 'z'];
const origin = 123456.789;

function fixture({ hz = 60, historyCount = 1 } = {}) {
  const points = Array.from({ length: 30 * hz }, (_, i) => ({
    t: origin + 1000 * i / hz,
    x: 0.03 * Math.sin(2 * Math.PI * 1.2 * i / hz),
    y: 0.02 * Math.cos(2 * Math.PI * 0.25 * i / hz),
    z: 9.81 + 0.025 * Math.sin(2 * Math.PI * 2.4 * i / hz),
  }));
  const report = analyzeMotion(points);
  assert.ok(report);
  const events = Array.from({ length: 36 }, (_, i) => origin + 500 + i * 800);
  const scg = {
    dataGaps: [],
    eventTimesMs: events,
    eventIntervals: events.slice(1).map((endMs, i) => ({ startMs: events[i], endMs, durationMs: 800, status: 'accepted' })),
    quality: 'candidate',
    explanation: 'Återkommande mekaniska impulser upptäcktes. De är INTE bekräftade hjärtslag.',
    sampleRateHz: hz,
    candidateEvents: events.length,
    medianIntervalMs: 800,
    intervalVariationPercent: 3.123456789,
    windowConsistency: true,
    artifactFraction: 0.000023456789,
    axis: 'x',
    filteredWaveform: Array.from({ length: 180 }, (_, i) => Math.sin(i / 10) / 100),
    intervalCoveragePercent: 97.1234567,
    rejectedIntervals: 1,
    shortIntervals: 0,
    longIntervals: 1,
    baselineRms: 9.81,
    signalRms: 0.02123456789,
    artifactWarning: null,
    timingJitterMs: 0.0123456789,
    resampled: true,
    eventTemplate: Array.from({ length: 31 }, (_, i) => Math.sin(i) / 100),
    templateEventCount: 30,
    templateConsistency: 0.84567891,
    signalOrigin: 'unverified_mechanical',
    harmonicCheck: { candidateHz: 1.25, halfFrequencyHz: 0.625, interpretation: 'Unverified mechanical origin.' },
    harmonicChecks: axes.map(axis => ({ axis, fundamentalHz: 1.2, secondHarmonicHz: 2.4, frequencyRatio: 2, windowsAgree: false })),
  };
  const spectrum = {
    bands: [
      { name: 'Långsam rörelse', fromHz: 0.1, toHz: 0.5, peakHz: 0.25, strength: 0.000000123456789 },
      { name: 'Periodisk rörelse', fromHz: 0.7, toHz: 3, peakHz: 1.2, strength: 0.00000000456789123 },
      { name: 'Snabb vibration', fromHz: 3, toHz: 15, peakHz: null, strength: 0 },
    ],
    windowsAgree: true,
    dominantHz: 1.2,
    harmonicChecks: scg.harmonicChecks,
    harmonicStatus: 'unconfirmed',
    warning: 'Exploratory frequency analysis; not verified heartbeats or diagnosis.',
  };
  const channel = (frequency) => ({
    durationSeconds: report.durationSeconds,
    count: points.length,
    axes: axes.map(axis => ({ axis, rms: 0.0123456789, frequencyHz: frequency, power: 0.0000000123456789 })),
    origin: 'unverified mechanical',
    gaps: 0,
  });
  const comparison = {
    accAxis: 'x', gyroAxis: 'z', lagMs: 20,
    trainingCorrelation: 0.723456789,
    validationCorrelation: 0.6123456789,
    validationPairs: 700,
    repeatable: true,
  };
  return {
    source: 'ScanIt iPhone browser accelerometer',
    timestamp: '2026-11-26T00:00:00.000Z',
    note: 'Phone remained still; brief sensation around 16 seconds.',
    measurement: 'accelerationIncludingGravity', units: 'm/s²',
    caution: 'Not an ECG, heart rate, or validated clinical measurement. Do not infer diagnoses.',
    summary: report,
    sensorSource: hz === 200 ? 'Accelerometer API (requested 200 Hz)' : 'DeviceMotion',
    requestedSensorHz: hz === 200 ? 200 : null,
    protocol: { mode: 'sternum', position: 'Reclined approximately 45 degrees, iPhone on sternum', referenceBpm: null, capturedDurationSeconds: report.durationSeconds, completeCapture: true },
    exploratoryScg: scg,
    exploratorySpectrum: spectrum,
    multimodal: {
      clock: 'performance.now relative to common session origin; delivery timestamps, not hardware synchronization',
      accelerationStartMs: 5.12345678,
      gcg: {
        units: 'degrees/s', sampleCount: points.length, analysis: channel(1.2),
        columns: ['elapsed_ms', 'beta', 'gamma', 'alpha'],
        samples: points.map(p => [p.t - origin, p.x, p.y, p.z - 9.81]),
      },
      resp: { acceleration: channel(0.25), rotation: channel(0.25), warning: 'Candidate low-frequency motion, not validated respiration' },
      crossAnalysis: {
        overlapSeconds: report.durationSeconds,
        gridHz: 50, pairedCoverage: 0.98123456789,
        mechanical: comparison,
        respiratory: { ...comparison, validationCorrelation: null, repeatable: false },
        scgCandidateHz: 1.25,
        frequencyDifferences: axes.map(axis => ({ axis, frequencyHz: 1.2, differenceHz: 0.05 })),
        warning: 'Exploratory correlations; thresholds unvalidated. Shared motion and delivery latency can produce agreement. No diagnosis or verified heart/respiratory rate.',
      },
    },
    pairedControl: { sternum: { motion: report, spectrum }, table: { motion: { ...report, variationRms: 0.00000123456789 }, spectrum } },
    repeatedMeasurements: { sternum: Array.from({ length: 5 }, () => ({ rms: report.variationRms, scg })), table: [] },
    repeatability: {
      count: 5, rmsRangePercent: 12.12345678, medianIntervalRangePercent: null,
      waveformSimilarity: -0.234567891, templateSimilarity: 0.8123456789, templatePairs: 4,
      conclusion: 'Describes repeatability of mechanical signals, not heart rhythm or health status.',
    },
    personalHistory: Array.from({ length: historyCount }, (_, i) => ({
      timestamp: `2026-11-${String(1 + i % 25).padStart(2, '0')}T00:00:00.000Z`,
      mode: 'sternum', rms: report.variationRms, scg, referenceBpm: null, note: 'previous measurement',
    })),
    samples: points.map(p => [Math.round(p.t - origin), Number(p.x.toFixed(5)), Number(p.y.toFixed(5)), Number(p.z.toFixed(5))]),
    columns: ['elapsed_ms', 'ax', 'ay', 'az'],
  };
}

function assertNoRawArrays(value) {
  const forbidden = new Set(['samples', 'personalHistory', 'filteredWaveform', 'eventTemplate', 'eventTimesMs', 'eventIntervals', 'dataGaps', 'harmonicCheck', 'harmonicChecks', 'repeatedMeasurements', 'columns', 'segments']);
  function visit(item) {
    if (Array.isArray(item)) {
      assert.ok(item.length <= 3, 'Only bounded three-axis/three-band overview arrays should remain');
      item.forEach(visit);
    } else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        assert.ok(!forbidden.has(key), `Unexpected detailed field: ${key}`);
        visit(child);
      }
    }
  }
  visit(value);
}

test('clipboard summary is parseable, bounded, and independent of raw rows and history growth', () => {
  for (const hz of [60, 200]) {
    const small = fixture({ hz, historyCount: 1 });
    const full = fixture({ hz, historyCount: 100 });
    const shortText = serializeCompactMeasurement(small);
    const fullText = serializeCompactMeasurement(full);
    const a = JSON.parse(shortText);
    const b = JSON.parse(fullText);
    assert.ok(fullText.length < 12000, `Unexpected clipboard size: ${fullText.length}`);
    assert.ok(fullText.length - shortText.length <= 2, 'History contents must not grow the summary');
    assert.equal(a.historyCount, 1);
    assert.equal(b.historyCount, 100);
    assert.deepEqual({ ...a, historyCount: 0 }, { ...b, historyCount: 0 });
    assert.equal(b.exportType, 'compact_summary');
    assert.equal(b.schemaVersion, 1);
    assert.equal(b.timestamp, full.timestamp);
    assert.equal(b.note, full.note);
    assert.equal(b.summary.count, hz * 30);
    assert.equal(b.summary.samplingHz, hz);
    assert.equal(b.detail.rawSamplesIncluded, false);
    assert.equal(b.detail.historyRecordsIncluded, false);
    assert.match(b.detail.forDetailedAnalysis, /full JSON.*exact-time/);
    assert.match(b.caution, /Not an ECG/);
    assertNoRawArrays(b);
    const oldSize = JSON.stringify(full).length;
    assert.ok(fullText.length < oldSize * 0.05, 'Full history fixture should shrink by at least 95%');
    console.log(`${hz} Hz, 100 prior reports: ${oldSize} -> ${fullText.length} characters (${(100 * (1 - fullText.length / oldSize)).toFixed(2)}% smaller)`);
  }
});

test('quality limitations, gaps, rejected intervals and cross-validation survive sharing', () => {
  const input = fixture();
  input.summary.quality = 'poor';
  input.summary.qualityText = 'Otillräcklig signal';
  input.summary.gaps = 4;
  input.summary.clipped = true;
  input.exploratoryScg.quality = 'insufficient';
  input.exploratoryScg.explanation = 'Timing gaps limit this measurement.';
  input.exploratoryScg.dataGaps = [
    { startMs: 124000, endMs: 124500, durationMs: 500 },
    { startMs: 129000, endMs: 130000, durationMs: 1000 },
  ];
  input.exploratoryScg.rejectedIntervals = 8;
  input.exploratoryScg.artifactWarning = 'Intervals may understate variability.';
  const output = JSON.parse(serializeCompactMeasurement(input));
  assert.equal(output.summary.quality, 'poor');
  assert.equal(output.summary.gaps, 4);
  assert.equal(output.summary.clipped, true);
  assert.equal(output.exploratoryScg.quality, 'insufficient');
  assert.equal(output.exploratoryScg.explanation, input.exploratoryScg.explanation);
  assert.equal(output.exploratoryScg.dataGapCount, 2);
  assert.equal(output.exploratoryScg.rejectedIntervals, 8);
  assert.equal(output.exploratoryScg.artifactWarning, input.exploratoryScg.artifactWarning);
  assert.equal(output.multimodal.crossAnalysis.respiratory.validationCorrelation, null);
  assert.equal(output.multimodal.crossAnalysis.respiratory.repeatable, false);
  assert.equal(output.multimodal.crossAnalysis.mechanical.validationPairs, 700);
  assert.equal(output.multimodal.crossAnalysis.pairedCoverage, 0.981235);
  assert.equal(output.multimodal.crossAnalysis.warning, input.multimodal.crossAnalysis.warning);
});

test('early stop and absent analyses remain explicitly incomplete and null', () => {
  const input = fixture();
  input.summary.durationSeconds = 6.25;
  input.summary.quality = 'poor';
  input.protocol.capturedDurationSeconds = 6.25;
  input.protocol.completeCapture = false;
  input.exploratoryScg = null;
  input.exploratorySpectrum = null;
  input.repeatability = null;
  input.pairedControl = {};
  input.multimodal = null;
  const output = JSON.parse(serializeCompactMeasurement(input));
  assert.equal(output.protocol.completeCapture, false);
  assert.equal(output.protocol.capturedDurationSeconds, 6.25);
  assert.equal(output.summary.quality, 'poor');
  assert.equal(output.exploratoryScg, null);
  assert.equal(output.exploratorySpectrum, null);
  assert.equal(output.multimodal, null);
  assert.equal(output.repeatability, null);
  assert.deepEqual(output.pairedControl, { sternum: null, table: null });
});

test('missing gyro is not presented as zero-valued measured rotation', () => {
  const input = fixture();
  input.multimodal.gcg = { units: 'degrees/s', sampleCount: 0, samples: [], analysis: null };
  input.multimodal.resp.rotation = null;
  input.multimodal.crossAnalysis = null;
  const output = JSON.parse(serializeCompactMeasurement(input));
  assert.equal(output.multimodal.gcg.sampleCount, 0);
  assert.equal(output.multimodal.gcg.analysis, null);
  assert.equal(output.multimodal.resp.rotation, null);
  assert.ok(output.multimodal.resp.acceleration);
  assert.equal(output.multimodal.crossAnalysis, null);
  assertNoRawArrays(output);
});

test('significant figures preserve tiny spectral powers, nulls, false, and negative correlations', () => {
  const input = fixture();
  const output = JSON.parse(serializeCompactMeasurement(input));
  const powers = output.exploratorySpectrum.bands.map(band => band.strength);
  assert.equal(powers[0], 1.23457e-7);
  assert.equal(powers[1], 4.56789e-9);
  assert.equal(powers[2], 0);
  assert.equal(output.exploratorySpectrum.bands[2].peakHz, null);
  assert.equal(output.protocol.referenceBpm, null);
  assert.equal(output.repeatability.medianIntervalRangePercent, null);
  assert.equal(output.repeatability.waveformSimilarity, -0.234568);
  assert.equal(output.multimodal.crossAnalysis.respiratory.repeatable, false);
  assert.ok(output.multimodal.gcg.analysis.axes[0].power > 0);
});

test('export does not mutate full-precision measurements or historical records', () => {
  const input = fixture({ hz: 200, historyCount: 100 });
  const before = JSON.stringify(input);
  const seen = new WeakSet();
  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  deepFreeze(input);
  serializeCompactMeasurement(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(input.samples.length, 6000);
  assert.equal(input.multimodal.gcg.samples.length, 6000);
  assert.equal(input.personalHistory.length, 100);
});

test('lightweight payload needs no raw rows and never serializes history records', () => {
  const input = fixture();
  delete input.samples;
  delete input.multimodal.gcg.samples;
  input.historyCount = 100;
  delete input.personalHistory;
  const output = JSON.parse(serializeCompactMeasurement(input));
  assert.equal(output.historyCount, 100);
  assert.equal(output.multimodal.gcg.sampleCount, 1800);

  delete input.historyCount;
  input.personalHistory = [{ toJSON() { throw new Error('Must not serialize personal history'); } }];
  Object.defineProperty(input, 'samples', { get() { throw new Error('Must not inspect raw readings'); } });
  assert.equal(JSON.parse(serializeCompactMeasurement(input)).historyCount, 1);
});
