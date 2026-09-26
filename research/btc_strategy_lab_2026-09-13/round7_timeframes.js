const { wrapTrend } = require('./templates');

// Round 7: timeframe sweep. The one strategy that passed BOTH the
// full-history test AND the Round 6 out-of-sample walk-forward check was
// "EMA50/100 cross + VWAP confirmation + 2.0x ATR stop" on ETH, 2h bars.
// This round holds the strategy logic completely fixed and sweeps the
// timeframe across 30m/1h/4h/12h (all valid Bybit intervals: 30,60,240,720)
// on both ETH (the validated symbol -- does a different timeframe do even
// better, or does 2h stay best?) and BTC (does a different timeframe than
// the 2h one that failed out-of-sample actually hold up?).

const SYMBOLS = { ETH: 'ETHUSDT', BTC: 'BTCUSDT' };
const TIMEFRAMES = { '30m': '30', '1h': '60', '4h': '240', '12h': '720' };

function coreSource(title) {
  return wrapTrend({
    title,
    inputs: '',
    indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\nvwapVal = ta.vwap(close)`,
    longCond: 'ta.crossover(emaFast, emaSlow) and close > vwapVal',
    shortCond: 'ta.crossunder(emaFast, emaSlow) and close < vwapVal',
    atrMult: 2.0,
  });
}

const batch = [];
for (const [ticker, symbol] of Object.entries(SYMBOLS)) {
  for (const [label, tf] of Object.entries(TIMEFRAMES)) {
    batch.push({
      id: `R7_${ticker}_${label}_VWAP_EMA`,
      round: 7,
      symbol,
      timeframe: tf,
      concept: `Timeframe sweep of the validated EMA50/100+VWAP+2xATR strategy: ${ticker} on ${label} bars`,
      hypothesis: 'Holding the exact strategy logic fixed and only varying timeframe isolates whether timeframe itself (not indicator choice) drives the edge, and whether a different timeframe changes the BTC/ETH outcome.',
      pineSource: coreSource(`${ticker} ${label} VWAP EMA`),
    });
  }
}

module.exports = batch;
