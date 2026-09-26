/**
 * src/agents/technicalLab/strategy.js
 * The ONE strategy from the 2026-09-13 strategy lab that survived both a
 * full-history test AND an honest out-of-sample walk-forward check — see
 *   F:\aitradingagent\research\btc_strategy_lab_2026-09-13\FINAL_REPORT.md
 * for the full ~80-strategy research trail. Ported verbatim (rules
 * unchanged) from F:\aitradingagent2\src\agents\technicalAgent.js so the
 * main project gets the exact same validated logic, not a re-derivation.
 *
 * Do not "improve" this logic without re-running that lab's validation
 * methodology — a strategy that looks better on a single backtest is the
 * exact failure mode the lab exists to catch.
 *
 * RULES (frozen):
 *   - 2-hour bars (see priceFeed.js — Bybit, matches the research source).
 *   - Long entry:  EMA(50) crosses ABOVE EMA(100) AND close > session VWAP.
 *   - Short entry: EMA(50) crosses BELOW EMA(100) AND close < session VWAP.
 *   - Stop-loss: fixed at entry, 2.0 x ATR(14) away. No fixed take-profit —
 *     rides until the opposite cross fires (flip-to-reverse) or stop hit.
 *
 * PER-TOKEN GATING: only ETH passed BOTH the full-history and out-of-sample
 * checks. SOL is "watch only" (computed + logged, never traded). Everything
 * else is OFF with the specific research reason attached — see TOKEN_STATUS.
 */
'use strict';
const { ema, atr, sessionVwap, crossover, crossunder } = require('./indicators');

const STRATEGY_ID = 'lab_2h_ema50_100_vwap_v1';

const TOKEN_STATUS = {
  ETH:  { enabled: true,  reason: 'Validated: pctPF held up full-history (1.30) AND out-of-sample (1.27) — the only combination that passed both checks.' },
  SOL:  { enabled: false, reason: 'Watch only: full-history edge (pctPF 1.37) weakened to ~break-even (1.01) out-of-sample. Not enabled until re-validated.' },
  BTC:  { enabled: false, reason: 'Disabled: full-history edge (pctPF 1.50) REVERSED out-of-sample (0.88) — regime-specific artifact, not real edge.' },
  AVAX: { enabled: false, reason: 'Disabled: full-history edge (pctPF 1.57) reversed badly out-of-sample (0.60).' },
  ARB:  { enabled: false, reason: 'Disabled: no edge found on either full-history or out-of-sample checks (short Bybit listing history).' },
  OP:   { enabled: false, reason: 'Disabled: no edge found on either full-history or out-of-sample checks (short Bybit listing history).' },
  CRO:  { enabled: false, reason: 'Disabled: no edge found (a possible 4h/no-VWAP variant showed a weak signal but only 54 out-of-sample trades — inconclusive, not adopted).' },
};

const EMA_FAST_LEN = 50;
const EMA_SLOW_LEN = 100;
const ATR_LEN = 14;
const ATR_STOP_MULT = 2.0;

/**
 * @param {string} token
 * @param {Array}  candles  2-hour candles with real volume (priceFeed.getIntradayCandles).
 */
function run(token, candles) {
  const status = TOKEN_STATUS[token] || { enabled: false, reason: `${token} was never part of the validated research set.` };

  const minBars = EMA_SLOW_LEN + 5;
  if (!candles || candles.length < minBars) {
    return { signal: 'HOLD', direction: 'FLAT', confidence: 0,
      reason: `Not enough 2h history for ${token} (need ${minBars}+ bars).`, constraints: {}, strategyId: STRATEGY_ID };
  }

  const closes = candles.map((c) => c.close);
  const emaFast = ema(closes, EMA_FAST_LEN);
  const emaSlow = ema(closes, EMA_SLOW_LEN);
  const vwap = sessionVwap(candles);
  const atrVals = atr(candles, ATR_LEN);
  const i = candles.length - 1;
  const price = closes[i];

  const longCross = crossover(emaFast, emaSlow, i) && price > vwap[i];
  const shortCross = crossunder(emaFast, emaSlow, i) && price < vwap[i];

  let direction = 'FLAT';
  if (longCross) direction = 'LONG';
  else if (shortCross) direction = 'SHORT';

  if (direction === 'FLAT') {
    return { signal: 'HOLD', direction, confidence: 0,
      reason: `No EMA${EMA_FAST_LEN}/${EMA_SLOW_LEN}+VWAP cross this bar for ${token}.`,
      constraints: {}, strategyId: STRATEGY_ID };
  }

  if (!status.enabled) {
    return { signal: 'HOLD', direction, confidence: 0,
      reason: `${direction} signal fired for ${token} but this token is not enabled: ${status.reason}`,
      constraints: {}, strategyId: STRATEGY_ID, signalSuppressed: true };
  }

  const stopDistance = ATR_STOP_MULT * atrVals[i];
  const stopPrice = direction === 'LONG' ? price - stopDistance : price + stopDistance;

  return {
    signal: direction === 'LONG' ? 'BUY' : 'SELL',
    direction,
    // 0.75 reflects "this exact validated rule fired," not a win-probability
    // estimate — this strategy's own backtest win rate is ~13% (classic
    // trend-following: many small losses, rare large winners).
    confidence: 0.75,
    reason: `${direction} entry: EMA${EMA_FAST_LEN}/${EMA_SLOW_LEN} cross + VWAP confirm on ${token} 2h (validated: ${status.reason})`,
    constraints: {
      stopPrice: Number(stopPrice.toFixed(6)),
      targetPrice: null,
      exitOnOppositeSignal: true,
      atr: Number(atrVals[i].toFixed(6)),
    },
    strategyId: STRATEGY_ID,
  };
}

module.exports = { run, TOKEN_STATUS, STRATEGY_ID, EMA_FAST_LEN, EMA_SLOW_LEN, ATR_LEN, ATR_STOP_MULT };
