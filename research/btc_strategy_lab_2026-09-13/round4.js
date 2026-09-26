const { wrapTrend, wrapMeanRev } = require('./templates');

// Round 3 found the real edge: R3c_2h_SameLogic (2h EMA50/100 cross + ADX>20
// filter + 2.0x ATR fixed stop) qualifies on net profit, trade count (319)
// and profit factor (1.27 raw / 1.30 pct-based) but fails the raw-engine
// drawdown check (46.8%) -- though resimulation under realistic 20%
// fixed-fractional sizing shows it ALREADY qualifies (net +24.1%, DD
// 17.66%). Round 4 does two things: (a) a parameter-robustness sweep around
// R3c to rule out lucky-overfit and see if ANY nearby setting also clears
// the RAW engine's drawdown bar outright, and (b) two genuinely new
// concepts not yet tried (manual Ichimoku cloud trend-following; a
// low-ADX/ranging-regime mean-reversion complement using Bollinger %B) to
// keep researching new ideas per the instruction not to just refine one
// strategy forever.

module.exports = [
  {
    id: 'R4a_2h_ADX15',
    round: 4,
    concept: 'R3c robustness check: same 2h EMA50/100+2xATR logic, ADX threshold lowered 20->15',
    hypothesis: 'If the edge is real (not a lucky threshold pick) it should degrade gracefully, not collapse, when ADX bar is loosened.',
    timeframe: '120',
    pineSource: wrapTrend({
      title: 'BTC 2h ADX15 Robustness',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(15, "ADX Threshold")`,
      indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh',
      atrMult: 2.0,
    }),
  },
  {
    id: 'R4b_2h_ADX25',
    round: 4,
    concept: 'R3c robustness check: ADX threshold raised 20->25 (more selective)',
    hypothesis: 'Higher selectivity should raise profit factor further at the cost of trade count -- mapping the trade-off directly around the winner.',
    timeframe: '120',
    pineSource: wrapTrend({
      title: 'BTC 2h ADX25 Robustness',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(25, "ADX Threshold")`,
      indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh',
      atrMult: 2.0,
    }),
  },
  {
    id: 'R4c_2h_ATRstop1_5x',
    round: 4,
    concept: 'R3c robustness check: fixed stop tightened 2.0x -> 1.5x ATR',
    hypothesis: 'A tighter stop should cut per-trade worst-case loss and drawdown, at the cost of more whipsaw stop-outs on normal pullback noise.',
    timeframe: '120',
    pineSource: wrapTrend({
      title: 'BTC 2h Stop1.5x Robustness',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(20, "ADX Threshold")`,
      indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh',
      atrMult: 1.5,
    }),
  },
  {
    id: 'R4d_2h_ATRstop2_5x',
    round: 4,
    concept: 'R3c robustness check: stop widened 2.0x -> 2.5x ATR',
    hypothesis: 'A wider stop should reduce whipsaw stop-outs and could raise win rate/PF, at the cost of a larger loss per losing trade.',
    timeframe: '120',
    pineSource: wrapTrend({
      title: 'BTC 2h Stop2.5x Robustness',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(20, "ADX Threshold")`,
      indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh',
      atrMult: 2.5,
    }),
  },
  {
    id: 'R4e_3h_SameLogic',
    round: 4,
    concept: 'Identical EMA50/100+ADX20+2xATR logic on 3h bars (between the 2h winner and 4h original)',
    hypothesis: 'If 2h beats 4h on trade count/profit and 4h beats 2h on drawdown, 3h might land at a genuinely better combined point on the trade-off curve.',
    timeframe: '180',
    pineSource: wrapTrend({
      title: 'BTC 3h Trend Follow ADX',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(20, "ADX Threshold")`,
      indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh',
      atrMult: 2.0,
    }),
  },
  {
    id: 'R4f_2h_Ichimoku_TrendFollow',
    round: 4,
    concept: 'NEW: manual Ichimoku cloud (Tenkan/Kijun cross + price outside Kumo cloud) built from ta.highest/ta.lowest only, on 2h bars',
    hypothesis: 'Ichimoku is a classic multi-component trend system never tested in rounds 1-3; a Tenkan/Kijun cross confirmed by cloud position is a well-known trend-confirmation combo worth a direct BTC test.',
    timeframe: '120',
    pineSource: wrapTrend({
      title: 'BTC 2h Ichimoku Trend',
      inputs: `tenkanLen = input.int(9, "Tenkan Len")\nkijunLen = input.int(26, "Kijun Len")\nspanBLen = input.int(52, "Span B Len")`,
      indicators: `tenkan = (ta.highest(high, tenkanLen) + ta.lowest(low, tenkanLen)) / 2\nkijun = (ta.highest(high, kijunLen) + ta.lowest(low, kijunLen)) / 2\nspanA = (tenkan + kijun) / 2\nspanB = (ta.highest(high, spanBLen) + ta.lowest(low, spanBLen)) / 2\ncloudTop = math.max(spanA, spanB)\ncloudBottom = math.min(spanA, spanB)`,
      longCond: 'ta.crossover(tenkan, kijun) and close > cloudTop',
      shortCond: 'ta.crossunder(tenkan, kijun) and close < cloudBottom',
      atrMult: 2.0,
    }),
  },
  {
    id: 'R4g_2h_BBPercentB_MeanRev_LowADX',
    round: 4,
    concept: 'NEW: regime-complement mean-reversion. Fade Bollinger %B extremes (<0.05 / >0.95) ONLY when ADX<18 (i.e. NOT the trending regime R3c trades) -- explicitly trades the opposite market state to the trend-follow winner',
    hypothesis: 'If R3c captures the trending regime, a %B mean-reversion system gated to fire ONLY in the low-ADX/ranging regime should be a genuinely different, uncorrelated source of edge (a common institutional pattern: regime-switch between trend and range systems).',
    timeframe: '120',
    pineSource: wrapMeanRev({
      title: 'BTC 2h BB PercentB MeanRev LowADX',
      inputs: `bbLen = input.int(20, "BB Len")\nbbMult = input.float(2.0, "BB Mult")\nadxLen = input.int(14, "ADX Len")\nadxCap = input.int(18, "ADX Cap (range regime)")`,
      indicators: `[bbMid, bbUpper, bbLower] = ta.bb(close, bbLen, bbMult)\npercentB = (close - bbLower) / (bbUpper - bbLower)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'percentB < 0.05 and adxVal < adxCap',
      shortCond: 'percentB > 0.95 and adxVal < adxCap',
      stopMult: 1.5,
      targetMult: 2.5,
    }),
  },
  {
    id: 'R4h_2h_VWAP_EMA_Confluence',
    round: 4,
    concept: 'NEW: R3c-style EMA50/100 cross, but additionally requires price to be on the correct side of session VWAP as a second, independent trend confirmation',
    hypothesis: 'VWAP is a widely-cited institutional fair-value reference; requiring EMA-cross entries to agree with VWAP position should filter out lower-quality crosses and could raise profit factor without cutting trade count too much.',
    timeframe: '120',
    pineSource: wrapTrend({
      title: 'BTC 2h VWAP EMA Confluence',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(20, "ADX Threshold")`,
      indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)\nvwapVal = ta.vwap(close)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh and close > vwapVal',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh and close < vwapVal',
      atrMult: 2.0,
    }),
  },
];
