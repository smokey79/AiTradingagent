/**
 * src/engine/trainer.js (2026-10-03) -- fits and honestly tests the multi-horizon model. No I/O (scripts/engine_train.js feeds it candles).
 *
 * Time order is respected: train (first 60%) -> calibrate and choose the probability threshold (next 20%) -> test (last 20%, touched once).
 * A gap of one horizon is left between slices so labels cannot leak across a boundary. Signals in the test slice are counted
 * non-overlapping per coin (one position at a time), after fees + spread + slippage, so the t-statistics are not inflated by overlapping windows.
 */
'use strict';

const F = require('./features');
const M = require('./model');

const HOUR = 3600000;
const classOf = (lr, band) => (lr > band ? 2 : lr < -band ? 0 : 1);

function buildSamples(seriesByPair, h, band, candleMinutes = 60) {
  const out = [];
  const steps = Math.round(h * 60 / candleMinutes);
  if (steps < 1 || Math.abs(steps * candleMinutes - h * 60) > 1e-6) throw new Error('Horizon must align with candle timeframe');
  for (const [pair, candles] of Object.entries(seriesByPair)) {
    const P = F.prepare(candles);
    if (!P) continue;
    for (let i = F.MIN_INDEX; i + steps < P.n; i++) {
      if (P.ts[i + steps] - P.ts[i] !== steps * candleMinutes * 60000) continue;
      const x = F.featuresAt(P, i);
      if (!x) continue;
      const lr = Math.log(P.c[i + steps] / P.c[i]);
      out.push({ pair, ts: P.ts[i], x, lr, y: classOf(lr, band) });
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

function stats(nets) {
  const n = nets.length;
  if (!n) return { n: 0, mean: 0, sd: 0, t: 0, winRate: null, profitFactor: null, maxDrawdown: 0 };
  const mean = nets.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(nets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1));
  let gw = 0, gl = 0, eq = 0, peak = 0, dd = 0;
  for (const x of nets) { if (x > 0) gw += x; else gl -= x; eq += x; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return { n, mean, sd, t: sd > 0 ? mean / (sd / Math.sqrt(n)) : 0, winRate: nets.filter((x) => x > 0).length / n, profitFactor: gl > 0 ? gw / gl : (gw > 0 ? 99 : 0), maxDrawdown: dd };
}

/** Trades the rule would have taken (one position per coin at a time), as a list of net returns in time order. */
function signalNets(samples, preds, t, cost, h) {
  const idx = samples.map((_, i) => i), nextFree = new Map(), taken = [];
  for (const i of idx) {                                   // samples are already time-sorted
    const s = samples[i], p = preds[i];
    if (s.ts < (nextFree.get(s.pair) || 0)) continue;
    const eLong = p.pUp >= t ? p.expCal - cost : -1, eShort = p.pDown >= t ? -p.expCal - cost : -1;
    if (eLong <= 0 && eShort <= 0) continue;
    const side = eLong >= eShort ? 1 : -1;
    taken.push({ ts: s.ts, net: side * (Math.exp(s.lr) - 1) - cost });
    nextFree.set(s.pair, s.ts + h * HOUR);
  }
  return taken.sort((a, b) => a.ts - b.ts).map((x) => x.net);
}

function brier(preds, samples) {
  let s = 0;
  for (let i = 0; i < samples.length; i++) { const p = preds[i], y = samples[i].y; s += (p.pDown - (y === 0)) ** 2 + (p.pFlat - (y === 1)) ** 2 + (p.pUp - (y === 2)) ** 2; }
  return s / Math.max(1, samples.length);
}

function reliability(ps, hits) {
  const edges = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 1.01], rows = [];
  for (let b = 0; b < edges.length - 1; b++) {
    const idx = ps.map((p, i) => i).filter((i) => ps[i] >= edges[b] && ps[i] < edges[b + 1]);
    if (idx.length) rows.push({ range: `${edges[b].toFixed(1)}-${Math.min(1, edges[b + 1]).toFixed(1)}`, n: idx.length, avgPredicted: +(idx.reduce((s, i) => s + ps[i], 0) / idx.length).toFixed(3), observed: +(idx.reduce((s, i) => s + hits[i], 0) / idx.length).toFixed(3) });
  }
  return rows;
}

function trainHorizon(samples, h, cfg) {
  const [a, b] = cfg.train.split;
  const n = samples.length;
  if (n < 900) throw new Error(`not enough data for horizon ${h}h (${n} samples)`);
  const t1 = samples[Math.floor(n * a)].ts, t2 = samples[Math.floor(n * (a + b))].ts, gap = h * HOUR;
  const train = samples.filter((s) => s.ts < t1 - gap), calib = samples.filter((s) => s.ts >= t1 && s.ts < t2 - gap), test = samples.filter((s) => s.ts >= t2);
  if (train.length < 500 || calib.length < 200 || test.length < 200) throw new Error(`not enough data for horizon ${h}h (train ${train.length}, calib ${calib.length}, test ${test.length})`);

  const scaler = M.standardize(train.map((s) => s.x));
  const Xtr = train.map((s) => M.apply(scaler, s.x));
  const W = M.softmaxFit(Xtr, train.map((s) => s.y), { l2: cfg.train.l2, epochs: cfg.train.epochs, lr: cfg.train.lr });
  const beta = M.ridgeFit(Xtr, train.map((s) => s.lr), 50);
  const base = [0, 0, 0]; train.forEach((s) => base[s.y]++);
  const baseRates = { down: base[0] / train.length, flat: base[1] / train.length, up: base[2] / train.length };

  const bundle = { h, scaler, W, beta, calUp: { identity: true, knots: [] }, calDown: { identity: true, knots: [] }, fit: { slope: 1, intercept: 0, sigma: 0, slopeSe: 1, interceptSe: 0 }, baseRates };
  // calibration + shrinkage fitted on the calibration slice only
  const rawC = calib.map((s) => M.softmaxProbs(W, M.apply(scaler, s.x)));
  bundle.calUp = M.fitCalibrator(rawC.map((p) => p[2]), calib.map((s) => (s.y === 2 ? 1 : 0)));
  bundle.calDown = M.fitCalibrator(rawC.map((p) => p[0]), calib.map((s) => (s.y === 0 ? 1 : 0)));
  bundle.fit = M.fitSlope(calib.map((s) => M.ridgePredict(beta, M.apply(scaler, s.x))), calib.map((s) => s.lr), h * 60 / (cfg.candleMinutes || 60));

  const predict = (set) => set.map((s) => M.predictBundle(bundle, s.x));
  const pc = predict(calib), pt = predict(test);
  const cost = cfg.assumedCostRT;

  // choose the probability threshold on the CALIBRATION slice (never on test)
  let best = null;
  for (const t of [0.45, 0.5, 0.55, 0.6, 0.65, 0.7]) {
    const st = stats(signalNets(calib, pc, t, cost, h));
    if (st.n >= 30 && st.mean > 0 && (!best || st.t > best.stats.t)) best = { t, stats: st };
  }

  const baseP = { pDown: baseRates.down, pFlat: baseRates.flat, pUp: baseRates.up };
  const bTest = brier(pt, test), bBase = brier(test.map(() => baseP), test);
  const brierSkill = 1 - bTest / bBase;
  const testStats = best ? stats(signalNets(test, pt, best.t, cost, h)) : null;
  const allStats = stats(signalNets(test, pt, 0.0, cost, h));            // every signal the edge rule alone would take
  const bar = cfg.validationBar;
  const reasons = [];
  if (!best) reasons.push('no probability threshold showed a positive net edge on the calibration slice');
  if (brierSkill <= bar.minBrierSkill) reasons.push(`Brier skill ${brierSkill.toFixed(4)} is not better than predicting the base rates`);
  if (testStats) {
    if (testStats.n < bar.minOosSignals) reasons.push(`only ${testStats.n} out-of-sample signals (need ${bar.minOosSignals})`);
    if (testStats.mean <= bar.minMeanNetReturn) reasons.push(`mean net return ${(testStats.mean * 100).toFixed(3)}% per trade is not positive`);
    if (testStats.profitFactor <= bar.minProfitFactor) reasons.push(`profit factor ${testStats.profitFactor.toFixed(2)} <= ${bar.minProfitFactor}`);
  }
  bundle.recommendedMinProb = best ? best.t : null;
  bundle.validation = {
    horizonH: h, nTrain: train.length, nCalib: calib.length, nTest: test.length, testFrom: new Date(t2).toISOString(),
    baseRates, brier: +bTest.toFixed(5), brierBase: +bBase.toFixed(5), brierSkill: +brierSkill.toFixed(5),
    slope: +bundle.fit.slope.toFixed(4), slopeSe: +bundle.fit.slopeSe.toFixed(4),
    reliabilityUp: reliability(pt.map((p) => p.pUp), test.map((s) => (s.y === 2 ? 1 : 0))), reliabilityDown: reliability(pt.map((p) => p.pDown), test.map((s) => (s.y === 0 ? 1 : 0))),
    chosenThreshold: best ? best.t : null, calibrationSliceSignals: best ? best.stats : null, testSignals: testStats, testAllEdgeSignals: allStats,
    validated: reasons.length === 0, failReasons: reasons,
  };
  return bundle;
}

function trainModel(seriesByPair, cfg) {
  const horizons = {};
  const sets = cfg.horizonTimeframes ? Object.values(seriesByPair) : [seriesByPair];
  const info = { pairs: new Set(sets.flatMap(s => Object.keys(s))).size, candles: sets.reduce((sum, s) => sum + Object.values(s).reduce((n, c) => n + c.length, 0), 0) };
  for (const h of cfg.horizonsH) {
    const timeframe = cfg.horizonTimeframes?.[h] || '1h';
    const candleMinutes = { '5m': 5, '1h': 60, '1d': 1440 }[timeframe];
    const series = cfg.horizonTimeframes ? (seriesByPair[timeframe] || {}) : seriesByPair;
    const samples = buildSamples(series, h, cfg.flatBand, candleMinutes);
    try {
      horizons[h] = trainHorizon(samples, h, { ...cfg, candleMinutes });
      horizons[h].timeframe = timeframe;
    } catch (e) {
      if (!cfg.horizonTimeframes) throw e;
      horizons[h] = { h, timeframe, unavailable: true, validation: { validated: false, failReasons: [e.message] } };
    }
  }
  const primary = horizons[cfg.primaryHorizonH];
  return {
    version: cfg.horizonTimeframes ? 2 : 1, trainedAt: new Date().toISOString(), features: F.NAMES, flatBand: cfg.flatBand, horizonsH: cfg.horizonsH, primaryHorizonH: cfg.primaryHorizonH,
    data: info, horizons, validated: !!primary.validation.validated, recommendedMinProb: primary.recommendedMinProb,
  };
}

module.exports = { trainModel, buildSamples, signalNets, stats, brier, classOf };
