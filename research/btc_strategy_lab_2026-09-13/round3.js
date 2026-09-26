const { wrapTrend, wrapMeanRev } = require('./templates');

// Round 2 finding: EVERY 1h strategy (single or confluence) still had a
// negative edge (PF 0.61-0.97) — 1h BTC appears too noisy/efficient for
// classical indicator systems. But R2_4h_TrendFollow_ADX (EMA50/100 cross +
// ADX>20 filter, on 4h bars) was the FIRST genuinely positive result: net
// +162%, PF 1.50 — just short on trade count (168, need 250) and drawdown
// (47%, need <=20%). Round 3 concentrates entirely on refining that one
// real lead: more signals (faster EMAs / lower ADX bar / shorter timeframe)
// and tighter risk control (smaller ATR stop, or a ratcheting trail instead
// of a fixed stop) to try to pull it inside the qualification bar.

function trailingTrend({ title, inputs = '', indicators, longCond, shortCond, atrLen = 14, trailMult = 1.5 }) {
  return `//@version=6
strategy("${title}", overlay=true, pyramiding=1,
  process_orders_on_close=true, commission_type=strategy.commission.percent,
  commission_value=0.05, initial_capital=10000,
  default_qty_type=strategy.percent_of_equity, default_qty_value=100,
  margin_long=100, margin_short=100)
${inputs}
atrVal = ta.atr(${atrLen})
${indicators}
longEntry = ${longCond}
shortEntry = ${shortCond}

var float longTrail = na
var float shortTrail = na

if longEntry
    strategy.entry("L", strategy.long)
    longTrail := close - atrVal * ${trailMult}
if shortEntry
    strategy.entry("S", strategy.short)
    shortTrail := close + atrVal * ${trailMult}

if strategy.position_size > 0
    newLong = close - atrVal * ${trailMult}
    longTrail := na(longTrail) ? newLong : math.max(longTrail, newLong)
    strategy.exit("LX", from_entry="L", stop=longTrail)
if strategy.position_size < 0
    newShort = close + atrVal * ${trailMult}
    shortTrail := na(shortTrail) ? newShort : math.min(shortTrail, newShort)
    strategy.exit("SX", from_entry="S", stop=shortTrail)
`;
}

module.exports = [
  {
    id: 'R3a_4h_TighterStop',
    round: 3,
    concept: 'R2 winner (4h EMA50/100+ADX20) with fixed stop tightened from 2.5x to 1.5x ATR',
    hypothesis: 'A tighter fixed stop should cut the 47% drawdown toward the 20% bar without changing entry frequency.',
    timeframe: '240',
    pineSource: wrapTrend({
      title: 'BTC 4h Tighter Stop',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(20, "ADX Threshold")`,
      indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh',
      atrMult: 1.5,
    }),
  },
  {
    id: 'R3b_4h_ATRTrail',
    round: 3,
    concept: 'R2 winner with a RATCHETING ATR(1.5x) trailing stop instead of a fixed stop — locks in gains, cuts giveback',
    hypothesis: 'A fixed stop lets a winning trend trade round-trip all the way back down before exiting; a trail should capture more of the move and cut max drawdown.',
    timeframe: '240',
    pineSource: trailingTrend({
      title: 'BTC 4h ATR Trail',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(20, "ADX Threshold")`,
      indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh',
      trailMult: 1.5,
    }),
  },
  {
    id: 'R3c_2h_SameLogic',
    round: 3,
    concept: 'Identical EMA50/100+ADX20 logic, on 2h bars — roughly 2x the bar count of 4h for more trade opportunities',
    hypothesis: 'More bars at a still-reasonably-low noise timeframe should push trade count toward/above 250 while keeping most of the edge.',
    timeframe: '120',
    pineSource: wrapTrend({
      title: 'BTC 2h Trend Follow ADX',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(20, "ADX Threshold")`,
      indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh',
      atrMult: 2.0,
    }),
  },
  {
    id: 'R3d_4h_FasterEMA_LowerADX',
    round: 3,
    concept: 'Faster EMA20/50 (vs 50/100) and lower ADX bar (15 vs 20) on 4h — more signals, slightly less selective',
    hypothesis: 'More frequent, slightly-less-strict entries should raise trade count toward 250 while the underlying 4h/trend/ADX edge is retained.',
    timeframe: '240',
    pineSource: wrapTrend({
      title: 'BTC 4h Faster EMA Lower ADX',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(15, "ADX Threshold")`,
      indicators: `emaFast = ta.ema(close, 20)\nemaSlow = ta.ema(close, 50)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh',
      atrMult: 2.0,
    }),
  },
  {
    id: 'R3e_2h_ATRTrail_FasterEMA',
    round: 3,
    concept: 'Combine the two most promising fixes: 2h timeframe (more trades) + faster EMA20/50 (more signals) + ATR trail (tighter drawdown)',
    hypothesis: 'Stacking all three fixes together is the best shot at clearing both the 250-trade and 20%-drawdown bars simultaneously.',
    timeframe: '120',
    pineSource: trailingTrend({
      title: 'BTC 2h Trail Faster EMA',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(15, "ADX Threshold")`,
      indicators: `emaFast = ta.ema(close, 20)\nemaSlow = ta.ema(close, 50)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh',
      trailMult: 1.5,
    }),
  },
  {
    id: 'R3f_4h_Donchian_ADX',
    round: 3,
    concept: 'Retest round-1\'s Donchian(20) breakout idea, but on 4h with the ADX>20 filter added (round 1 tested it on 1h with no filter and it failed badly)',
    hypothesis: 'Breakout systems are known to need higher timeframes to avoid false breaks — worth a direct retest now that 4h is confirmed to help trend-following.',
    timeframe: '240',
    pineSource: wrapTrend({
      title: 'BTC 4h Donchian ADX',
      inputs: `donLen = input.int(20, "Donchian Length")\nadxLen = input.int(14, "ADX Len")\nadxTh = input.int(20, "ADX Threshold")`,
      indicators: `upperCh = ta.highest(high, donLen)[1]\nlowerCh = ta.lowest(low, donLen)[1]\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'close > upperCh and adxVal > adxTh',
      shortCond: 'close < lowerCh and adxVal > adxTh',
      atrMult: 2.0,
    }),
  },
  {
    id: 'R3g_4h_SuperTrend_ADX_Retest',
    round: 3,
    concept: 'Retest round-1\'s SuperTrend+ADX idea (PF 0.86 on 1h) on 4h bars instead',
    hypothesis: 'Same logic as R3f — several round-1 concepts may simply have been tested on the wrong (too-noisy) timeframe.',
    timeframe: '240',
    pineSource: wrapTrend({
      title: 'BTC 4h SuperTrend ADX',
      inputs: `stMult = input.float(3.0, "ST Mult")\nstLen = input.int(10, "ST Len")\nadxLen = input.int(14, "ADX Len")\nadxTh = input.int(20, "ADX Threshold")`,
      indicators: `[supertrend, direction] = ta.supertrend(stMult, stLen)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossunder(direction, 0) and adxVal > adxTh',
      shortCond: 'ta.crossover(direction, 0) and adxVal > adxTh',
      atrMult: 2.0,
    }),
  },
  {
    id: 'R3h_2h_ATRTrail_ADX25',
    round: 3,
    concept: '2h EMA50/100 + ATR trail(1.5x), but ADX threshold raised to 25 (more selective than R3e) to see the selectivity/trade-count trade-off directly',
    hypothesis: 'Direct A/B against R3e/R3c to map how ADX threshold trades off selectivity (fewer, cleaner signals) against raw trade count.',
    timeframe: '120',
    pineSource: trailingTrend({
      title: 'BTC 2h Trail ADX25',
      inputs: `adxLen = input.int(14, "ADX Len")\nadxTh = input.int(25, "ADX Threshold")`,
      indicators: `emaFast = ta.ema(close, 50)\nemaSlow = ta.ema(close, 100)\n[diPlus, diMinus, adxVal] = ta.dmi(adxLen, adxLen)`,
      longCond: 'ta.crossover(emaFast, emaSlow) and adxVal > adxTh',
      shortCond: 'ta.crossunder(emaFast, emaSlow) and adxVal > adxTh',
      trailMult: 1.5,
    }),
  },
];
