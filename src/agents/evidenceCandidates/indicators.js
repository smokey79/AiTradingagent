/**
 * src/agents/evidenceCandidates/indicators.js
 * Pine-equivalent indicators so live signals match the TradingKit backtests:
 *   ema  = ta.ema (seeded with SMA)       atr = ta.atr (RMA of true range)
 *   dmi  = ta.dmi -> ADX (RMA smoothing)  vwap = ta.vwap(close), reset each UTC day
 * All take candles oldest-first: {timestamp, open, high, low, close, volume}.
 * Values are null until enough history exists.
 */
'use strict';

function sma(values, n, i) {
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += values[k];
  return s / n;
}

function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const a = 2 / (n + 1);
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) continue;
    out[i] = i === n - 1 ? sma(values, n, i) : a * values[i] + (1 - a) * out[i - 1];
  }
  return out;
}

function rma(values, n) {
  const out = new Array(values.length).fill(null);
  let started = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    if (started < 0) {
      // first index where n consecutive non-null values exist
      let ok = i - n + 1 >= 0;
      for (let k = i - n + 1; ok && k <= i; k++) if (values[k] == null) ok = false;
      if (!ok) continue;
      started = i;
      out[i] = sma(values, n, i);
    } else {
      out[i] = (out[i - 1] * (n - 1) + values[i]) / n;
    }
  }
  return out;
}

function trueRange(c) {
  return c.map((b, i) => (i === 0 ? b.high - b.low
    : Math.max(b.high - b.low, Math.abs(b.high - c[i - 1].close), Math.abs(b.low - c[i - 1].close))));
}

function atr(c, n = 14) { return rma(trueRange(c), n); }

function adx(c, n = 14) {
  const plusDM = [null], minusDM = [null];
  for (let i = 1; i < c.length; i++) {
    const up = c[i].high - c[i - 1].high;
    const down = c[i - 1].low - c[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const tr = trueRange(c); tr[0] = null;
  const trR = rma(tr, n), pR = rma(plusDM, n), mR = rma(minusDM, n);
  const dx = c.map((_, i) => {
    if (trR[i] == null || pR[i] == null || mR[i] == null || trR[i] === 0) return null;
    const p = 100 * pR[i] / trR[i], m = 100 * mR[i] / trR[i];
    return p + m === 0 ? 0 : 100 * Math.abs(p - m) / (p + m);
  });
  return rma(dx, n);
}

function vwapDaily(c) {
  let day = null, pv = 0, v = 0;
  return c.map((b) => {
    const d = Math.floor(b.timestamp / 86400000);
    if (d !== day) { day = d; pv = 0; v = 0; }
    pv += b.close * b.volume; v += b.volume;
    return v > 0 ? pv / v : b.close;
  });
}

module.exports = { ema, rma, atr, adx, vwapDaily, trueRange };
