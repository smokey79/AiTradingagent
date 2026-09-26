/**
 * Two reusable, mcprule-compliant Pine v6 skeletons so every strategy in the
 * lab shares the same verified-safe risk-management scaffolding, and only
 * the entry logic (the actual "idea" being tested) differs.
 *
 * TREND:    flip-to-reverse entries (standard for trend/crossover systems)
 *           + a real ATR stop set at entry (never left unprotected).
 * MEANREV:  ATR-multiple stop and take-profit computed from price at entry
 *           (absolute stop=/limit=, the rules doc's "Absolute ATR tiers"
 *           pattern) — gives an explicit, chosen reward:risk ratio.
 */

const HEADER = (title) => `strategy("${title}", overlay=true, pyramiding=1,
  process_orders_on_close=true, commission_type=strategy.commission.percent,
  commission_value=0.05, initial_capital=10000,
  default_qty_type=strategy.percent_of_equity, default_qty_value=100,
  margin_long=100, margin_short=100)`;

function wrapTrend({ title, inputs = '', indicators, longCond, shortCond, atrLen = 14, atrMult = 2.5 }) {
  return `//@version=6
${HEADER(title)}
${inputs}
atrVal = ta.atr(${atrLen})
${indicators}
longEntry = ${longCond}
shortEntry = ${shortCond}

var float longStop = na
var float shortStop = na

if longEntry
    strategy.entry("L", strategy.long)
    longStop := close - atrVal * ${atrMult}
if shortEntry
    strategy.entry("S", strategy.short)
    shortStop := close + atrVal * ${atrMult}

if strategy.position_size > 0
    strategy.exit("LX", from_entry="L", stop=longStop)
if strategy.position_size < 0
    strategy.exit("SX", from_entry="S", stop=shortStop)
`;
}

function wrapMeanRev({ title, inputs = '', indicators, longCond, shortCond, atrLen = 14, stopMult = 1.5, targetMult = 3.0 }) {
  return `//@version=6
${HEADER(title)}
${inputs}
atrVal = ta.atr(${atrLen})
${indicators}
longEntry = ${longCond}
shortEntry = ${shortCond}

var float longStop = na
var float longTarget = na
var float shortStop = na
var float shortTarget = na

if longEntry
    strategy.entry("L", strategy.long)
    longStop := close - atrVal * ${stopMult}
    longTarget := close + atrVal * ${targetMult}
if shortEntry
    strategy.entry("S", strategy.short)
    shortStop := close + atrVal * ${stopMult}
    shortTarget := close - atrVal * ${targetMult}

if strategy.position_size > 0
    strategy.exit("LX", from_entry="L", stop=longStop, limit=longTarget)
if strategy.position_size < 0
    strategy.exit("SX", from_entry="S", stop=shortStop, limit=shortTarget)
`;
}

module.exports = { wrapTrend, wrapMeanRev };
