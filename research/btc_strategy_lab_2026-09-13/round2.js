const { wrapTrend, wrapMeanRev } = require('./templates');

// Round 1 finding: every single/dual-indicator system had a genuinely
// negative sizing-independent edge (%-based profit factor 0.63-0.74) over
// the full 6.5y history at 1h, take-every-signal. Round 2 responds with:
//  (a) multi-condition CONFLUENCE filters (trend+strength+momentum agreeing)
//      instead of one/two indicators, per mainstream systematic-trading
//      practice and the "volatility-filtered momentum" research finding
//      (applied correctly this time — WITH the move, not fading it);
//  (b) market-structure-based entries (higher-high/higher-low continuation)
//      per Alan's explicit interest in market structure and repeating
//      patterns;
//  (c) a recent-2y window on a few entries as a regime-robustness check
//      against the full 6.5y stress test.
const RECENT_FROM_TS = Date.now() - 2 * 365 * 86400000;

module.exports = [
  {
    id: 'R2_TripleFilter_TrendStrengthMomentum',
    round: 2,
    concept: 'Confluence: close>EMA200 (trend) + ADX>25 (strength) + RSI 40-70 rising (healthy momentum, not overbought) + MACD hist>0',
    hypothesis: 'Round 1 single-filter systems failed; requiring trend + strength + momentum to ALL agree should cut false signals and isolate genuine trend continuation.',
    pineSource: wrapTrend({
      title: 'BTC Triple Filter Confluence',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(25, "ADX Threshold")\nrsiLen = input.int(14, "RSI Len")`,
      indicators: `emaTrend = ta.ema(close, 200)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)\nrsiVal = ta.rsi(close, rsiLen)\n[macdLine, macdSignal, macdHist] = ta.macd(close, 12, 26, 9)\nuptrend = close > emaTrend and adxVal > adxTh and rsiVal > 40 and rsiVal < 70 and macdHist > 0\ndowntrend = close < emaTrend and adxVal > adxTh and rsiVal < 60 and rsiVal > 30 and macdHist < 0`,
      longCond: 'uptrend and not uptrend[1]',
      shortCond: 'downtrend and not downtrend[1]',
      atrMult: 2.5,
    }),
  },
  {
    id: 'R2_VolFilteredMomentum_Corrected',
    round: 2,
    concept: 'Momentum WITH the trend (not fading) when ATR% is below its own 100-bar average — corrected application of the "volatility-filtered momentum" research finding',
    hypothesis: 'Round 1 wrongly applied this as mean-reversion (fade z-score extremes). The actual research result is momentum improves when traded WITH low-volatility trends, not against them.',
    pineSource: wrapTrend({
      title: 'BTC VolFiltered Momentum Corrected',
      inputs: `maLen = input.int(50, "MA Length")\nzTh = input.float(1.0, "Z Threshold")`,
      indicators: `maVal = ta.sma(close, maLen)\nsdVal = ta.stdev(close, maLen)\nzScore = (close - maVal) / sdVal\natrPct = atrVal / close * 100\natrPctAvg = ta.sma(atrPct, 100)\nvolOk = atrPct < atrPctAvg`,
      longCond: 'ta.crossover(zScore, zTh) and volOk',
      shortCond: 'ta.crossunder(zScore, -zTh) and volOk',
      atrMult: 2.0,
    }),
  },
  {
    id: 'R2_EMA_Ribbon_Alignment',
    round: 2,
    concept: 'Multi-EMA ribbon (5/10/20/50) fully stacked in order = strong aligned trend, enter on fresh alignment',
    hypothesis: 'A fully-stacked ribbon is a stronger, more selective trend confirmation than any single MA cross.',
    pineSource: wrapTrend({
      title: 'BTC EMA Ribbon Alignment',
      inputs: '',
      indicators: `e5 = ta.ema(close, 5)\ne10 = ta.ema(close, 10)\ne20 = ta.ema(close, 20)\ne50 = ta.ema(close, 50)\nbullStack = e5 > e10 and e10 > e20 and e20 > e50\nbearStack = e5 < e10 and e10 < e20 and e20 < e50`,
      longCond: 'bullStack and not bullStack[1]',
      shortCond: 'bearStack and not bearStack[1]',
      atrMult: 2.5,
    }),
  },
  {
    id: 'R2_KeltnerBreakout_ADXFiltered',
    round: 2,
    concept: 'ATR-based Keltner(20,2) breakout (adaptive to volatility, unlike fixed-price Donchian) filtered by ADX>20',
    hypothesis: 'Round 1 plain Donchian breakout failed; an ATR-adaptive channel plus a trend-strength filter should reject weak breakouts.',
    pineSource: wrapTrend({
      title: 'BTC Keltner Breakout ADX',
      inputs: `kcLen = input.int(20, "KC Length")\nkcMult = input.float(2.0, "KC Mult")\nadxLen = input.int(14, "ADX Len")\nadxTh = input.int(20, "ADX Threshold")`,
      indicators: `[kcMid, kcUpper, kcLower] = ta.kc(close, kcLen, kcMult)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossover(close, kcUpper) and adxVal > adxTh',
      shortCond: 'ta.crossunder(close, kcLower) and adxVal > adxTh',
      atrMult: 2.5,
    }),
  },
  {
    id: 'R2_RSI_PullbackBuy_TrendFollow',
    round: 2,
    concept: 'Buy RSI dips into the 40-50 zone (not oversold-extreme) while price stays above EMA100 — a trend pullback entry, not a reversal fade',
    hypothesis: 'Round 1 faded RSI extremes counter-trend; buying shallow pullbacks WITH an established trend is the standard professional approach to RSI.',
    pineSource: wrapTrend({
      title: 'BTC RSI Pullback Trend Follow',
      inputs: `rsiLen = input.int(14, "RSI Len")`,
      indicators: `emaTrend = ta.ema(close, 100)\nrsiVal = ta.rsi(close, rsiLen)`,
      longCond: 'close > emaTrend and ta.crossover(rsiVal, 45)',
      shortCond: 'close < emaTrend and ta.crossunder(rsiVal, 55)',
      atrMult: 2.0,
    }),
  },
  {
    id: 'R2_MACD_Volume_TrendFiltered',
    round: 2,
    concept: 'MACD histogram zero-cross confirmed by rising OBV, only traded in direction of EMA100 macro trend',
    hypothesis: 'Momentum (MACD) + volume (OBV) + macro trend agreement is a classic three-factor confluence — should filter out low-conviction crosses.',
    pineSource: wrapTrend({
      title: 'BTC MACD Volume Trend Filtered',
      inputs: '',
      indicators: `emaTrend = ta.ema(close, 100)\n[macdLine, macdSignal, macdHist] = ta.macd(close, 12, 26, 9)\nobvVal = ta.obv\nobvRising = obvVal > obvVal[10]\nobvFalling = obvVal < obvVal[10]`,
      longCond: 'close > emaTrend and ta.crossover(macdHist, 0) and obvRising',
      shortCond: 'close < emaTrend and ta.crossunder(macdHist, 0) and obvFalling',
      atrMult: 2.5,
    }),
  },
  {
    id: 'R2_BandWalk_Continuation',
    round: 2,
    concept: 'Bollinger %B pinned above 0.8 (or below 0.2) while ADX confirms trend = "band walking" continuation, not reversion',
    hypothesis: 'Round 1 faded band touches; in strong trends price rides the band rather than reverting — trading WITH that persistence should work better on trending BTC legs.',
    pineSource: wrapTrend({
      title: 'BTC Band Walk Continuation',
      inputs: `bbLen = input.int(20, "BB Length")\nbbMult = input.float(2.0, "BB Mult")\nadxLen = input.int(14, "ADX Len")\nadxTh = input.int(25, "ADX Threshold")`,
      indicators: `[bbMid, bbUpper, bbLower] = ta.bb(close, bbLen, bbMult)\npercentB = (close - bbLower) / (bbUpper - bbLower)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossover(percentB, 0.8) and adxVal > adxTh',
      shortCond: 'ta.crossunder(percentB, 0.2) and adxVal > adxTh',
      atrMult: 2.5,
    }),
  },
  {
    id: 'R2_HigherHighLow_Structure',
    round: 2,
    concept: 'Market-structure continuation: after a confirmed higher-low (5-bar pivot above the prior pivot low), buy the break of the most recent minor pivot high; mirror for downtrend structure',
    hypothesis: 'Classic price-action market-structure trading (higher-highs/higher-lows) — buying structure breaks should align entries with genuine trend continuation rather than lagging indicators.',
    pineSource: wrapTrend({
      title: 'BTC HH-HL Structure',
      inputs: `pivLen = input.int(5, "Pivot Bars Each Side")`,
      indicators: `pl = ta.pivotlow(low, pivLen, pivLen)\nph = ta.pivothigh(high, pivLen, pivLen)\nlastPL = ta.valuewhen(not na(pl), pl, 0)\nprevPL = ta.valuewhen(not na(pl), pl, 1)\nlastPH = ta.valuewhen(not na(ph), ph, 0)\nprevPH = ta.valuewhen(not na(ph), ph, 1)\nhigherLow = lastPL > prevPL\nlowerHigh = lastPH < prevPH`,
      longCond: 'higherLow and ta.crossover(close, lastPH)',
      shortCond: 'lowerHigh and ta.crossunder(close, lastPL)',
      atrMult: 2.5,
    }),
  },
  {
    id: 'R2_TripleFilter_Recent2y',
    round: 2,
    concept: 'Same Triple-Filter confluence as R2_TripleFilter, tested only on the last 2 years (2024-09 to 2026-09) as a market-regime robustness check',
    hypothesis: 'If this only works on old regimes (2020-21 bull) but not recently, that is itself an important robustness finding.',
    fromTs: RECENT_FROM_TS,
    pineSource: wrapTrend({
      title: 'BTC Triple Filter Recent2y',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(25, "ADX Threshold")\nrsiLen = input.int(14, "RSI Len")`,
      indicators: `emaTrend = ta.ema(close, 200)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)\nrsiVal = ta.rsi(close, rsiLen)\n[macdLine, macdSignal, macdHist] = ta.macd(close, 12, 26, 9)\nuptrend = close > emaTrend and adxVal > adxTh and rsiVal > 40 and rsiVal < 70 and macdHist > 0\ndowntrend = close < emaTrend and adxVal > adxTh and rsiVal < 60 and rsiVal > 30 and macdHist < 0`,
      longCond: 'uptrend and not uptrend[1]',
      shortCond: 'downtrend and not downtrend[1]',
      atrMult: 2.5,
    }),
  },
  {
    id: 'R2_4h_TrendFollow_ADX',
    round: 2,
    concept: 'Same EMA50/EMA100 cross + ADX filter concept, but on 4h bars instead of 1h — fewer, larger, less noisy trend trades',
    hypothesis: 'Higher timeframe should reduce whipsaw/noise-driven false signals that plagued every 1h system in round 1.',
    timeframe: '240',
    pineSource: wrapTrend({
      title: 'BTC 4h Trend Follow ADX',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(20, "ADX Threshold")`,
      indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh',
      atrMult: 2.5,
    }),
  },
  {
    id: 'R2_StochRSI_TrendFiltered',
    round: 2,
    concept: 'Stochastic %K/%D cross from oversold/overbought zones, only traded with the EMA100 trend (pullback-style, like R2_RSI_Pullback but with Stochastic)',
    hypothesis: 'A second oscillator-based pullback concept for comparison against the RSI version — tests whether the "pullback with trend" idea generalizes across oscillators.',
    pineSource: wrapTrend({
      title: 'BTC StochRSI Trend Filtered',
      inputs: `kLen = input.int(14, "Stoch K")\ndLen = input.int(3, "Stoch D")`,
      indicators: `emaTrend = ta.ema(close, 100)\nstochK = ta.stoch(close, high, low, kLen)\nstochD = ta.sma(stochK, dLen)`,
      longCond: 'close > emaTrend and ta.crossover(stochK, stochD) and stochK < 40',
      shortCond: 'close < emaTrend and ta.crossunder(stochK, stochD) and stochK > 60',
      atrMult: 2.0,
    }),
  },
];
