/**
 * src/engine/model.js (2026-10-03) -- the numerical core. No dependencies, no I/O.
 *   softmax regression  -> P(down), P(flat), P(up) for one horizon           (classes 0,1,2)
 *   ridge regression    -> expected log-return for that horizon
 *   calibration         -> isotonic-style reliability maps for P(up) and P(down), plus a slope that shrinks the expected return
 * Everything is fitted on one time slice and corrected on a later one, so the numbers it reports are not flattered by the data it learned from.
 */
'use strict';

const K = 3;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function standardize(X) {
  const d = X[0].length, mean = new Array(d).fill(0), std = new Array(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j];
  for (let j = 0; j < d; j++) mean[j] /= X.length;
  for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / Math.max(1, X.length - 1)) || 1;
  return { mean, std };
}
const apply = (s, x) => x.map((v, j) => (v - s.mean[j]) / s.std[j]);

function softmax(z) {
  const m = Math.max(...z); const e = z.map((v) => Math.exp(v - m)); const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

/** Full-batch gradient descent on standardized inputs. W is K x (d+1), last column = bias. */
function softmaxFit(Xs, y, { l2 = 1, epochs = 400, lr = 0.3 } = {}) {
  const n = Xs.length, d = Xs[0].length;
  const W = Array.from({ length: K }, () => new Array(d + 1).fill(0));
  const G = Array.from({ length: K }, () => new Array(d + 1).fill(0));
  for (let ep = 0; ep < epochs; ep++) {
    for (let k = 0; k < K; k++) G[k].fill(0);
    for (let i = 0; i < n; i++) {
      const x = Xs[i], z = new Array(K);
      for (let k = 0; k < K; k++) { let s = W[k][d]; for (let j = 0; j < d; j++) s += W[k][j] * x[j]; z[k] = s; }
      const p = softmax(z);
      for (let k = 0; k < K; k++) { const e = p[k] - (y[i] === k ? 1 : 0); for (let j = 0; j < d; j++) G[k][j] += e * x[j]; G[k][d] += e; }
    }
    const step = lr * (1 - 0.7 * ep / epochs);
    for (let k = 0; k < K; k++) { for (let j = 0; j < d; j++) W[k][j] -= step * (G[k][j] / n + (l2 / n) * W[k][j]); W[k][d] -= step * G[k][d] / n; }
  }
  return W;
}
function softmaxProbs(W, xs) {
  const d = xs.length, z = new Array(K);
  for (let k = 0; k < K; k++) { let s = W[k][d]; for (let j = 0; j < d; j++) s += W[k][j] * xs[j]; z[k] = s; }
  return softmax(z);
}

function solve(A, b) {                      // Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / piv; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / (M[i][i] || 1e-12); }
  return x;
}

/** Ridge (intercept not penalised). Returns beta of length d+1, last = intercept. */
function ridgeFit(Xs, r, lambda = 10) {
  const d = Xs[0].length, A = Array.from({ length: d + 1 }, () => new Array(d + 1).fill(0)), b = new Array(d + 1).fill(0);
  for (let i = 0; i < Xs.length; i++) {
    const x = [...Xs[i], 1];
    for (let a = 0; a <= d; a++) { b[a] += x[a] * r[i]; for (let c = 0; c <= d; c++) A[a][c] += x[a] * x[c]; }
  }
  for (let j = 0; j < d; j++) A[j][j] += lambda;
  return solve(A, b);
}
const ridgePredict = (beta, xs) => { let s = beta[xs.length]; for (let j = 0; j < xs.length; j++) s += beta[j] * xs[j]; return s; };

/** Pool-adjacent-violators: make y non-decreasing in x order. */
function pava(ys, ws) {
  const blocks = ys.map((y, i) => ({ y, w: ws[i], n: 1 }));
  const out = [];
  for (const b of blocks) {
    out.push({ ...b });
    while (out.length > 1 && out[out.length - 2].y > out[out.length - 1].y) {
      const b2 = out.pop(), b1 = out.pop(), w = b1.w + b2.w;
      out.push({ y: (b1.y * b1.w + b2.y * b2.w) / w, w, n: b1.n + b2.n });
    }
  }
  return out.flatMap((b) => new Array(b.n).fill(b.y));
}

/** Reliability map for one class probability: [{p, f}] knots (increasing). Falls back to identity when there is too little data. */
function fitCalibrator(p, hit, minPerBin = 150, maxBins = 10) {
  const n = p.length, bins = Math.min(maxBins, Math.floor(n / minPerBin));
  if (bins < 3) return { identity: true, knots: [] };
  const idx = [...p.keys()].sort((a, b) => p[a] - p[b]);
  const xs = [], ys = [], ws = [];
  for (let b = 0; b < bins; b++) {
    const lo = Math.floor(b * n / bins), hi = Math.floor((b + 1) * n / bins);
    let sp = 0, sh = 0; for (let t = lo; t < hi; t++) { sp += p[idx[t]]; sh += hit[idx[t]]; }
    xs.push(sp / (hi - lo)); ys.push(sh / (hi - lo)); ws.push(hi - lo);
  }
  const mono = pava(ys, ws);
  return { identity: false, knots: xs.map((x, i) => ({ p: x, f: mono[i] })) };
}
function calibrate(cal, p) {
  if (!cal || cal.identity || !cal.knots.length) return p;
  const k = cal.knots;
  if (p <= k[0].p) return k[0].f;
  if (p >= k[k.length - 1].p) return k[k.length - 1].f;
  for (let i = 1; i < k.length; i++) if (p <= k[i].p) { const t = (p - k[i - 1].p) / (k[i].p - k[i - 1].p || 1e-12); return k[i - 1].f + t * (k[i].f - k[i - 1].f); }
  return p;
}

/** Regress realised return on predicted return: slope < 1 means the raw forecast is over-confident. */
function fitSlope(pred, real, horizonH) {
  const n = pred.length, mp = pred.reduce((s, x) => s + x, 0) / n, mr = real.reduce((s, x) => s + x, 0) / n;
  let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (pred[i] - mp) ** 2; sxy += (pred[i] - mp) * (real[i] - mr); }
  const slope = sxx > 0 ? sxy / sxx : 0, intercept = mr - slope * mp;
  let sse = 0; for (let i = 0; i < n; i++) sse += (real[i] - intercept - slope * pred[i]) ** 2;
  const sigma = Math.sqrt(sse / Math.max(1, n - 2));
  const neff = Math.max(10, n / Math.max(1, horizonH));       // overlapping horizons carry fewer independent observations
  return { slope, intercept, sigma, slopeSe: sxx > 0 ? sigma / Math.sqrt(sxx * (neff / n)) : 1, interceptSe: sigma / Math.sqrt(neff) };
}

/** Prediction for one horizon bundle. */
function predictBundle(b, x) {
  const xs = apply(b.scaler, x);
  const raw = softmaxProbs(b.W, xs);
  let up = clamp(calibrate(b.calUp, raw[2]), 0.001, 0.998), dn = clamp(calibrate(b.calDown, raw[0]), 0.001, 0.998);
  if (up + dn > 0.999) { const s = (up + dn) / 0.999; up /= s; dn /= s; }
  const expRaw = ridgePredict(b.beta, xs);
  const expCal = b.fit.slope * expRaw + b.fit.intercept;
  const se = Math.sqrt((Math.abs(expRaw) * b.fit.slopeSe) ** 2 + b.fit.interceptSe ** 2);
  return { pUp: up, pFlat: Math.max(0, 1 - up - dn), pDown: dn, rawUp: raw[2], rawDown: raw[0], expRaw, expCal, se };
}

module.exports = { K, standardize, apply, softmaxFit, softmaxProbs, ridgeFit, ridgePredict, fitCalibrator, calibrate, fitSlope, predictBundle, pava, solve };
