// 3-candle setup strategy: EMA 14/50 trend + session VWAP + RSI(14) momentum.
// Pure functions, no I/O — used by the backtester and (later) by the bots.
// candles: [{t, o, h, l, c, v}] oldest -> newest.

function ema(values, period) {
  const k = 2 / (period + 1); const out = []; let prev;
  values.forEach((v, i) => { prev = i === 0 ? v : v * k + prev * (1 - k); out.push(i < period - 1 ? null : prev); });
  return out;
}

function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]; const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= period) { g += up; l += dn; if (i === period) { g /= period; l /= period; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } continue; }
    g = (g * (period - 1) + up) / period; l = (l * (period - 1) + dn) / period;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

// Session VWAP, resets every UTC day.
function vwap(candles) {
  let day = null, pv = 0, vol = 0;
  return candles.map(c => {
    const d = new Date(c.t).toISOString().slice(0, 10);
    if (d !== day) { day = d; pv = 0; vol = 0; }
    const tp = (c.h + c.l + c.c) / 3; pv += tp * c.v; vol += c.v;
    return vol > 0 ? pv / vol : c.c;
  });
}

const DEFAULTS = { emaFast: 14, emaSlow: 50, rsiPeriod: 14, rsiLongMin: 50, rsiLongMax: 70, rsiShortMin: 30, rsiShortMax: 50, rr: 1.5, minRiskPct: 0, maxRiskPct: 0.03, bodyLookback: 20 };

function indicators(candles, p = DEFAULTS) {
  const closes = candles.map(c => c.c);
  return { emaF: ema(closes, p.emaFast), emaS: ema(closes, p.emaSlow), rsi: rsi(closes, p.rsiPeriod), vwap: vwap(candles) };
}

// Signal on the candle at index i (candle 3 of the setup). Returns null or {side, entry, stop, target, reason}.
function signalAt(candles, ind, i, p = DEFAULTS) {
  if (i < Math.max(p.emaSlow, p.bodyLookback) + 2) return null;
  const [c1, c2, c3] = [candles[i - 2], candles[i - 1], candles[i]];
  const body = c => Math.abs(c.c - c.o);
  let avg = 0; for (let j = i - p.bodyLookback; j < i; j++) avg += body(candles[j]); avg /= p.bodyLookback;
  const eF = ind.emaF[i], eS = ind.emaS[i], r = ind.rsi[i], rPrev = ind.rsi[i - 1], vw = ind.vwap[i];
  if ([eF, eS, r, rPrev].some(x => x == null)) return null;

  // LONG: uptrend, above VWAP, impulse -> small pullback holding EMA50 -> breakout close above pullback high
  if (eF > eS && c3.c > vw && c1.c > c1.o && body(c1) >= avg && body(c2) < body(c1) * 0.6 && c2.h <= c1.h && c2.l > eS
      && c3.c > c3.o && c3.c > c2.h && r >= p.rsiLongMin && r <= p.rsiLongMax && r > rPrev) {
    const entry = c3.c, stop = Math.min(c1.l, c2.l, c3.l), risk = entry - stop;
    if (risk > 0 && risk / entry >= p.minRiskPct && risk / entry <= p.maxRiskPct) return { side: 'long', entry, stop, target: entry + p.rr * risk, reason: `EMA14>EMA50, >VWAP, RSI ${r.toFixed(1)}` };
  }
  // SHORT: mirror
  if (eF < eS && c3.c < vw && c1.c < c1.o && body(c1) >= avg && body(c2) < body(c1) * 0.6 && c2.l >= c1.l && c2.h < eS
      && c3.c < c3.o && c3.c < c2.l && r >= p.rsiShortMin && r <= p.rsiShortMax && r < rPrev) {
    const entry = c3.c, stop = Math.max(c1.h, c2.h, c3.h), risk = stop - entry;
    if (risk > 0 && risk / entry >= p.minRiskPct && risk / entry <= p.maxRiskPct) return { side: 'short', entry, stop, target: entry - p.rr * risk, reason: `EMA14<EMA50, <VWAP, RSI ${r.toFixed(1)}` };
  }
  return null;
}

module.exports = { DEFAULTS, ema, rsi, vwap, indicators, signalAt };
