/**
 * src/engine/features.js (2026-10-03) -- time-series features from OHLCV candles. Pure functions, no I/O.
 * Candles are [[ts, open, high, low, close, volume], ...] oldest first. Every feature is dimensionless and volatility-scaled so one
 * model can be pooled across coins of very different price and volatility.
 *
 * Microstructure (spread, depth, order-book imbalance) is NOT in the directional model: it has no history to train on. It is logged
 * (store.logMarket) so a later model can use it, and it is used right now for the cost / liquidity side of the gate.
 */
'use strict';

const NAMES = ['r1', 'r3', 'r6', 'r12', 'r24', 'vol12', 'volRatio', 'rsi', 'emaGap20', 'emaTrend', 'rangeZ', 'volumeZ', 'clv', 'distHigh', 'distLow'];
const MIN_INDEX = 50;           // first candle index with a full look-back
const clip = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function ema(arr, p) {
  const k = 2 / (p + 1), out = new Array(arr.length);
  let e = arr[0];
  for (let i = 0; i < arr.length; i++) { e = i === 0 ? arr[0] : arr[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

function rsiSeries(c, p = 14) {
  const out = new Array(c.length).fill(50);
  if (c.length <= p) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; }
  g /= p; l /= p;
  out[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (p - 1) + Math.max(d, 0)) / p; l = (l * (p - 1) + Math.max(-d, 0)) / p;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };

/** Valid candles only (finite, positive prices). Returns null if there are too few for any feature. */
function prepare(candles) {
  if (!Array.isArray(candles)) return null;
  const rows = candles.filter((r) => Array.isArray(r) && r.length >= 6 && r.slice(0, 6).every(x => Number.isFinite(Number(x))) && [1, 2, 3, 4].every((j) => Number(r[j]) > 0));
  if (rows.length < MIN_INDEX + 2) return null;
  const c = rows.map((r) => +r[4]);
  const lr = c.map((x, i) => (i === 0 ? 0 : Math.log(x / c[i - 1])));
  return { ts: rows.map((r) => +r[0]), o: rows.map((r) => +r[1]), h: rows.map((r) => +r[2]), l: rows.map((r) => +r[3]), c, v: rows.map((r) => +r[5] || 0), lr, e20: ema(c, 20), e50: ema(c, 50), rsi: rsiSeries(c), n: rows.length };
}

/** Feature vector at candle index i (uses only data up to and including i), or null. */
function featuresAt(P, i) {
  if (!P || i < MIN_INDEX || i >= P.n) return null;
  const w24 = P.lr.slice(i - 23, i + 1), w12 = P.lr.slice(i - 11, i + 1);
  const vol24 = Math.max(sd(w24), 1e-5), vol12 = Math.max(sd(w12), 1e-5);
  const ret = (k) => Math.log(P.c[i] / P.c[i - k]) / (vol24 * Math.sqrt(k));
  const rng = []; const lv = [];
  for (let j = i - 23; j <= i; j++) { rng.push((P.h[j] - P.l[j]) / P.c[j]); lv.push(Math.log1p(P.v[j])); }
  const z = (series, x) => { const s = sd(series); return s > 1e-12 ? (x - mean(series)) / s : 0; };
  const hi = Math.max(...P.h.slice(i - 23, i + 1)), lo = Math.min(...P.l.slice(i - 23, i + 1));
  const span = P.h[i] - P.l[i];
  const x = [
    clip(ret(1), -6, 6), clip(ret(3), -6, 6), clip(ret(6), -6, 6), clip(ret(12), -6, 6), clip(ret(24), -6, 6),
    clip(vol12 / vol24 - 1, -2, 3),                       // short vs long realised volatility (regime)
    (P.rsi[i] - 50) / 50,
    clip((P.c[i] / P.e20[i] - 1) / vol24, -6, 6),
    clip((P.e20[i] / P.e50[i] - 1) / vol24, -6, 6),
    clip(z(rng, rng[rng.length - 1]), -4, 4),
    clip(z(lv, lv[lv.length - 1]), -4, 4),
    span > 0 ? ((P.c[i] - P.l[i]) - (P.h[i] - P.c[i])) / span : 0,
    clip((P.c[i] - hi) / P.c[i] / vol24, -8, 0),
    clip((P.c[i] - lo) / P.c[i] / vol24, 0, 8),
  ];
  // NAMES has 15 entries (r1..r24, vol12, volRatio...): keep vector and names aligned
  return [x[0], x[1], x[2], x[3], x[4], vol12 * 100, x[5], x[6], x[7], x[8], x[9], x[10], x[11], x[12], x[13]];
}

/** Features for the most recent candle (live inference). */
function featuresLast(candles) {
  const P = prepare(candles);
  return P ? { x: featuresAt(P, P.n - 1), price: P.c[P.n - 1], ts: P.ts[P.n - 1], vol24: sd(P.lr.slice(-24)), atrPct: atrPct(P) } : null;
}

function atrPct(P, period = 14) {
  const tr = [];
  for (let i = Math.max(1, P.n - period); i < P.n; i++) tr.push(Math.max(P.h[i] - P.l[i], Math.abs(P.h[i] - P.c[i - 1]), Math.abs(P.l[i] - P.c[i - 1])));
  return tr.length ? (mean(tr) / P.c[P.n - 1]) * 100 : 0;
}

module.exports = { NAMES, MIN_INDEX, prepare, featuresAt, featuresLast, atrPct };
