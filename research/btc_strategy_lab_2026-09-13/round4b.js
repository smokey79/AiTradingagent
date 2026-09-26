const { wrapTrend } = require('./templates');

// R4h (VWAP+EMA+ADX confluence, 2h) had the best risk profile of the whole
// lab (PF 1.69, DD 36.3% raw / 10.6% at realistic 20% sizing) but only 218
// trades (need 250). Loosen the ADX filter 20->15 to admit more signals
// while keeping the VWAP+EMA confluence logic, to see if trade count clears
// the bar without giving back the quality.

module.exports = [
  {
    id: 'R4i_2h_VWAP_EMA_ADX15',
    round: 4,
    concept: 'R4h (best risk-adjusted result) with ADX threshold loosened 20->15 to admit more signals and try to clear the 250-trade minimum',
    hypothesis: 'VWAP+EMA confluence is the real quality filter; ADX may be over-restricting trade count without adding much extra quality on top of VWAP.',
    timeframe: '120',
    pineSource: wrapTrend({
      title: 'BTC 2h VWAP EMA ADX15',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(15, "ADX Threshold")`,
      indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)\nvwapVal = ta.vwap(close)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh and close > vwapVal',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh and close < vwapVal',
      atrMult: 2.0,
    }),
  },
  {
    id: 'R4j_2h_VWAP_EMA_NoADX',
    round: 4,
    concept: 'R4h with the ADX filter removed entirely -- pure EMA cross + VWAP side confirmation',
    hypothesis: 'Isolates whether ADX was adding value at all on top of VWAP, or whether VWAP alone is doing all the filtering work.',
    timeframe: '120',
    pineSource: wrapTrend({
      title: 'BTC 2h VWAP EMA NoADX',
      inputs: '',
      indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\nvwapVal = ta.vwap(close)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and close > vwapVal',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and close < vwapVal',
      atrMult: 2.0,
    }),
  },
];
