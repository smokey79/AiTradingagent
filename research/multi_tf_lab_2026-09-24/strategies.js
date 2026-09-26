/**
 * The 4 locked strategies from the 13 Sep lab (Round 8 "top 5", minus duplicates).
 * Logic is copied byte-for-byte in spirit from round8_top5.js / round7_timeframes.js;
 * nothing is re-tuned per coin or timeframe. Uses the 13 Sep Pine templates.
 * Note: ta.vwap(close) resets each session (daily). On 12h/1D bars it carries little
 * information; results there test the EMA/ADX part more than the VWAP part.
 */
const { wrapTrend } = require('../btc_strategy_lab_2026-09-13/templates');

const EMA = `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)`;
const ADX = (th) => ({ inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(${th}, "ADX Threshold")`,
  ind: `[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)` });

module.exports = {
  EMA_VWAP: (title) => wrapTrend({ title, indicators: `${EMA}\nvwapVal = ta.vwap(close)`,
    longCond: 'ta.crossover(emaFast, emaSlow) and close > vwapVal',
    shortCond: 'ta.crossunder(emaFast, emaSlow) and close < vwapVal', atrMult: 2.0 }),
  EMA_VWAP_ADX20: (title) => { const a = ADX(20); return wrapTrend({ title, inputs: a.inputs,
    indicators: `${EMA}\n${a.ind}\nvwapVal = ta.vwap(close)`,
    longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh and close > vwapVal',
    shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh and close < vwapVal', atrMult: 2.0 }); },
  EMA_ADX20_ATR15: (title) => { const a = ADX(20); return wrapTrend({ title, inputs: a.inputs,
    indicators: `${EMA}\n${a.ind}`,
    longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
    shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh', atrMult: 1.5 }); },
  EMA_ADX20_ATR25: (title) => { const a = ADX(20); return wrapTrend({ title, inputs: a.inputs,
    indicators: `${EMA}\n${a.ind}`,
    longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
    shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh', atrMult: 2.5 }); },
};
