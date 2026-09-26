/**
 * src/agents/technicalMtf/strategies.js
 * Live-signal versions of the two strategy families in backtest_mtf.py
 * that actually cleared the cross-cycle-robustness bar (ema_trend,
 * bb_meanrev -- rsi_momentum never won a single token/timeframe slot in
 * the 2026-09-23 research, so it isn't ported here).
 *
 * IMPORTANT -- how "live" maps onto the backtest's bar-indexing:
 * In backtest_mtf.py, entry[i] is decided from indicator values at bar
 * (i-1) [and i-2 for the EMA crossover], and the simulated trade opens
 * at the OPEN of bar i. There is no "bar i" yet in a live feed -- the
 * most recently CLOSED candle plays the role of bar (i-1), and "now"
 * (the current price) plays the role of the not-yet-formed bar i's open.
 * So: pass in candles up to and including the last CLOSED candle, and
 * these functions tell you whether bar (i-1)'s condition just fired --
 * i.e. whether you'd be entering right now.
 */
'use strict';
const { ema, rsi, atr, sma, rollingStd } = require('./indicators');

/**
 * EMA fast/slow crossover. params: { ema_fast_len, ema_slow_len, atr_mult, rr }
 */
function checkEmaTrendSignal(candles, params) {
  const { ema_fast_len, ema_slow_len, atr_mult, rr } = params;
  const n = candles.length;
  if (n < Math.max(ema_slow_len, 14) + 5) return { fired: false, reason: 'not enough candles' };

  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);

  const emaF = ema(close, ema_fast_len);
  const emaS = ema(close, ema_slow_len);
  const atrVals = atr(high, low, close, 14);

  const last = n - 1;      // most recently closed candle == backtest's bar (i-1)
  const prev = n - 2;      // == backtest's bar (i-2)
  const crossedUp = emaF[last] > emaS[last] && emaF[prev] <= emaS[prev];

  if (!crossedUp) return { fired: false };

  const currentPrice = close[last];
  const sd = atr_mult * atrVals[last];
  return {
    fired: true,
    entry: currentPrice,
    stop: currentPrice - sd,
    target: currentPrice + sd * rr,
    detail: { emaFast: emaF[last], emaSlow: emaS[last], atr: atrVals[last] },
  };
}

/**
 * Bollinger Band mean-reversion. params: { bb_len, bb_std, rsi_oversold, atr_mult }
 */
function checkBbMeanrevSignal(candles, params) {
  const { bb_len, bb_std, rsi_oversold, atr_mult } = params;
  const n = candles.length;
  if (n < Math.max(bb_len, 14) + 5) return { fired: false, reason: 'not enough candles' };

  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);

  const mid = sma(close, bb_len);
  const std = rollingStd(close, bb_len);
  const rsiVals = rsi(close, 14);
  const atrVals = atr(high, low, close, 14);

  const last = n - 1; // backtest's bar (i-1)
  if (mid[last] == null || std[last] == null) return { fired: false, reason: 'insufficient warmup' };
  const lowerBand = mid[last] - bb_std * std[last];

  const fired = close[last] < lowerBand && rsiVals[last] < rsi_oversold;
  if (!fired) return { fired: false };

  const currentPrice = close[last];
  return {
    fired: true,
    entry: currentPrice,
    stop: currentPrice - atr_mult * atrVals[last],
    target: mid[last],
    detail: { lowerBand, rsi: rsiVals[last], mid: mid[last] },
  };
}

module.exports = { checkEmaTrendSignal, checkBbMeanrevSignal };
