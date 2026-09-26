const { wrapTrend } = require('./templates');

// "Top 5" by raw engine profit factor across the whole lab, applied to
// every target asset. R4h and R4j already have full 7-symbol coverage from
// Round 5 -- reused from leaderboard.json, not re-run. This batch fills in
// the missing cells for the other 3: R4i (VWAP+EMA+ADX15, 2h), R3a
// (EMA+ADX20+1.5xATR, 4h), R2-style (EMA+ADX20+2.5xATR, 4h) -- each on the
// 6 non-BTC symbols.

const SYMBOLS = { ETH: 'ETHUSDT', SOL: 'SOLUSDT', AVAX: 'AVAXUSDT', ARB: 'ARBUSDT', OP: 'OPUSDT', CRO: 'CROUSDT' };

function r4iSource(title) {
  return wrapTrend({
    title,
    inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(15, "ADX Threshold")`,
    indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)\nvwapVal = ta.vwap(close)`,
    longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh and close > vwapVal',
    shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh and close < vwapVal',
    atrMult: 2.0,
  });
}
function r3aSource(title) {
  return wrapTrend({
    title,
    inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(20, "ADX Threshold")`,
    indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
    longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
    shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh',
    atrMult: 1.5,
  });
}
function r2Source(title) {
  return wrapTrend({
    title,
    inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(20, "ADX Threshold")`,
    indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
    longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
    shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh',
    atrMult: 2.5,
  });
}

const batch = [];
for (const [ticker, symbol] of Object.entries(SYMBOLS)) {
  batch.push({
    id: `R8_${ticker}_2h_VWAP_EMA_ADX15`, round: 8, symbol, timeframe: '120',
    concept: `Top-5 sweep: R4i template (VWAP+EMA+ADX15, 2h) on ${ticker}`,
    hypothesis: 'Complete the 5-strategy x 7-asset grid.',
    pineSource: r4iSource(`${ticker} 2h VWAP EMA ADX15`),
  });
  batch.push({
    id: `R8_${ticker}_4h_ADX20_1_5xATR`, round: 8, symbol, timeframe: '240',
    concept: `Top-5 sweep: R3a template (EMA+ADX20+1.5xATR, 4h) on ${ticker}`,
    hypothesis: 'Complete the 5-strategy x 7-asset grid.',
    pineSource: r3aSource(`${ticker} 4h ADX20 1.5xATR`),
  });
  batch.push({
    id: `R8_${ticker}_4h_ADX20_2_5xATR`, round: 8, symbol, timeframe: '240',
    concept: `Top-5 sweep: R2 template (EMA+ADX20+2.5xATR, 4h) on ${ticker}`,
    hypothesis: 'Complete the 5-strategy x 7-asset grid.',
    pineSource: r2Source(`${ticker} 4h ADX20 2.5xATR`),
  });
}

module.exports = batch;
