/**
 * src/agents/technicalLab/indicators.js
 * Shared technical-indicator math for the technical_lab agent ONLY — kept
 * separate from src/data/indicators.js (the main project's 1h-candle
 * indicator set) on purpose. These are the exact formulas the 2026-09-13
 * strategy lab validated (EMA, ATR, session VWAP, crossover/crossunder) —
 * see F:\aitradingagent\research\btc_strategy_lab_2026-09-13\FINAL_REPORT.md
 * and F:\aitradingagent2\src\indicators.js (identical, ported verbatim).
 *
 * Do not merge this into src/data/indicators.js or "simplify" it to reuse
 * the main project's EMA/ATR helpers — small formula differences (EMA seed
 * value, ATR smoothing) are enough to silently change signal timing, which
 * is exactly the failure mode the lab's out-of-sample test exists to catch.
 */
'use strict';

function ema(values, length) {
  const k = 2 / (length + 1);
  const out = new Array(values.length).fill(null);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function atr(candles, length) {
  const trs = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  return ema(trs, length);
}

/**
 * Session VWAP — matches Pine's default `ta.vwap()` behaviour: cumulative
 * (typical price * volume) / cumulative volume, resetting at each UTC day
 * boundary. Needs real per-candle volume (Bybit's 2h candles have it).
 */
function sessionVwap(candles) {
  const out = new Array(candles.length).fill(null);
  let cumPV = 0, cumVol = 0, sessionDay = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const day = Math.floor(c.timestamp / 86400000);
    if (day !== sessionDay) { sessionDay = day; cumPV = 0; cumVol = 0; }
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumPV += typicalPrice * c.volume;
    cumVol += c.volume;
    out[i] = cumVol > 0 ? cumPV / cumVol : c.close;
  }
  return out;
}

/** True at index i if series `a` crossed above series `b` between i-1 and i. */
function crossover(a, b, i) {
  return i > 0 && a[i - 1] <= b[i - 1] && a[i] > b[i];
}

/** True at index i if series `a` crossed below series `b` between i-1 and i. */
function crossunder(a, b, i) {
  return i > 0 && a[i - 1] >= b[i - 1] && a[i] < b[i];
}

module.exports = { ema, atr, sessionVwap, crossover, crossunder };
