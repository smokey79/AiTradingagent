const { wrapTrend } = require('./templates');

// Round 5: cross-asset extension. R4j (2h EMA50/100 cross + VWAP side filter,
// no ADX) was the best strategy that cleared all 4 criteria on BTC; R4h (same
// + ADX>20) was the best RISK-ADJUSTED result in the whole lab (PF 1.80, DD
// only 10.6% at 20% exposure) but fell 32 trades short of the 250 minimum on
// BTC alone. Testing the identical, unmodified logic on the other 6 target
// tokens checks whether the edge is genuine cross-asset market structure
// (2h trend + VWAP confirmation) rather than a BTC-specific fluke, and
// whether combining trade counts across symbols clears 250 for the
// higher-quality ADX-filtered variant.

const SYMBOLS = {
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  AVAX: 'AVAXUSDT',
  ARB: 'ARBUSDT',
  OP: 'OPUSDT',
  CRO: 'CROUSDT',
};

function noAdxSource(title) {
  return wrapTrend({
    title,
    inputs: '',
    indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\nvwapVal = ta.vwap(close)`,
    longCond: 'ta.crossover(emaFast, emaSlow) and close > vwapVal',
    shortCond: 'ta.crossunder(emaFast, emaSlow) and close < vwapVal',
    atrMult: 2.0,
  });
}

function adxSource(title) {
  return wrapTrend({
    title,
    inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(20, "ADX Threshold")`,
    indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)\nvwapVal = ta.vwap(close)`,
    longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh and close > vwapVal',
    shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh and close < vwapVal',
    atrMult: 2.0,
  });
}

const batch = [];
for (const [ticker, symbol] of Object.entries(SYMBOLS)) {
  batch.push({
    id: `R5_${ticker}_2h_VWAP_EMA_NoADX`,
    round: 5,
    symbol,
    timeframe: '120',
    concept: `Cross-asset extension of the BTC winner (R4j): identical, unmodified 2h EMA50/100+VWAP logic on ${ticker}/USDT`,
    hypothesis: 'If this is genuine market structure and not a BTC fluke, the same unmodified rules should show a similar (not necessarily identical) edge on other liquid majors/alts.',
    pineSource: noAdxSource(`${ticker} 2h VWAP EMA NoADX`),
  });
  batch.push({
    id: `R5_${ticker}_2h_VWAP_EMA_ADX20`,
    round: 5,
    symbol,
    timeframe: '120',
    concept: `Cross-asset extension of the best-risk-adjusted BTC result (R4h): identical 2h EMA50/100+ADX20+VWAP logic on ${ticker}/USDT`,
    hypothesis: 'Combining trade counts across all 7 symbols for this higher-quality ADX-filtered variant may clear the 250-trade minimum that BTC alone (218 trades) missed by 32.',
    pineSource: adxSource(`${ticker} 2h VWAP EMA ADX20`),
  });
}

module.exports = batch;
