/**
 * src/agents/technicalMtf/indicators.js
 * Exact JS port of the indicator math in F:\aitradingagent\backtest_mtf.py
 * (the 2026-09-23 15m/1h/4h top-50 research). Deliberately line-for-line
 * equivalent to the Python/numpy versions so the LIVE signal this agent
 * fires matches what the backtest actually validated -- a strategy whose
 * live math drifts from its backtest math is an unvalidated script by
 * this project's own standard.
 *
 * NOTE: `ema()` here is the SIMPLIFIED ema used throughout backtest_mtf.py
 * -- seeded with the first value (out[0] = values[0]), not an SMA-seeded
 * EMA. Do not "fix" this to a textbook EMA; that would break parity with
 * the validated backtest.
 */
'use strict';

function ema(values, length) {
  const k = 2 / (length + 1);
  const out = new Array(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function rsi(closes, length = 14) {
  const n = closes.length;
  const out = new Array(n).fill(50.0);
  const delta = new Array(n).fill(0);
  for (let i = 1; i < n; i++) delta[i] = closes[i] - closes[i - 1];
  const gain = delta.map((d) => Math.max(d, 0));
  const loss = delta.map((d) => Math.max(-d, 0));
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < n; i++) {
    if (i <= length) {
      avgGain = (avgGain * (i - 1) + gain[i]) / i;
      avgLoss = (avgLoss * (i - 1) + loss[i]) / i;
    } else {
      avgGain = (avgGain * (length - 1) + gain[i]) / length;
      avgLoss = (avgLoss * (length - 1) + loss[i]) / length;
    }
    const rs = avgLoss === 0 ? 100.0 : avgGain / avgLoss;
    out[i] = avgLoss === 0 ? 100.0 : 100 - 100 / (1 + rs);
  }
  return out;
}

function atr(high, low, close, length = 14) {
  const n = close.length;
  const prevClose = new Array(n);
  prevClose[0] = close[0];
  for (let i = 1; i < n; i++) prevClose[i] = close[i - 1];
  const tr = new Array(n);
  for (let i = 0; i < n; i++) {
    tr[i] = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - prevClose[i]),
      Math.abs(low[i] - prevClose[i])
    );
  }
  return ema(tr, length);
}

function sma(values, length) {
  const n = values.length;
  const out = new Array(n).fill(null);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

// pandas .rolling(length).std() default is SAMPLE std (ddof=1) -- divide by (length-1).
function rollingStd(values, length) {
  const n = values.length;
  const out = new Array(n).fill(null);
  for (let i = length - 1; i < n; i++) {
    let mean = 0;
    for (let j = i - length + 1; j <= i; j++) mean += values[j];
    mean /= length;
    let variance = 0;
    for (let j = i - length + 1; j <= i; j++) variance += (values[j] - mean) ** 2;
    variance /= (length - 1);
    out[i] = Math.sqrt(variance);
  }
  return out;
}

module.exports = { ema, rsi, atr, sma, rollingStd };
