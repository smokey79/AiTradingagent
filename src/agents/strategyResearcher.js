/**
 * src/agents/strategyResearcher.js — evidence-gated self-learning research.
 *
 * Added 2026-09-27, porting the design already built and proven out in
 * F:\aitradingagent2\src\agents\strategyResearcher.js into the LIVE bot,
 * per Alan's explicit instruction to make this actually change trading
 * rather than just log research.
 *
 * This is NOT a voting agent and never proposes or blocks a specific trade
 * by itself. It computes exact win-rate stats FROM CODE (never an LLM) out
 * of the bot's own real closed trades in trade_ledger.json, then exposes
 * two evidence-gated lookups — getTimingGuidance() and getDirectionGuidance()
 * — that riskGate.js calls on every trade check. Each one stays silent
 * (hasSignal:false) until there are at least STRATEGY_RESEARCH_MIN_PER_BUCKET
 * (default 5) real trades in that specific hour/direction slice for that
 * pair — a thin sample is never treated as a pattern. When there IS enough
 * evidence and it's historically weak, riskGate.js RAISES the confidence
 * bar for that one cycle. It never lowers the bar, never vetoes outright
 * (bear/majority/drawdown checks already own vetoes), and a lookup error
 * here can never block a live trade.
 *
 * Uses the SAME trade-validity filter as tradeLedger.js's getPerformanceStats
 * (exclude PENDING, simulated, excludeFromLearning, and FLASHLOAN records) so
 * this can never be taught by the phantom-profit / fabricated-arb records
 * documented in claude/session-2026-09-15-inventory-and-phantom-profit-audit.md.
 */
'use strict';
const { loadLedger } = require('../risk/tradeLedger');

const LOOKBACK_TRADES = Number(process.env.STRATEGY_RESEARCH_LOOKBACK || 200);
const MIN_TRADES_PER_BUCKET = Number(process.env.STRATEGY_RESEARCH_MIN_PER_BUCKET || 5);
const CAUTION_WIN_RATE_PCT = Number(process.env.STRATEGY_RESEARCH_CAUTION_WIN_RATE || 35);

/** Same validity filter as tradeLedger.js's getPerformanceStats — never let a
 * fabricated arb/simulated/pending record count as real evidence. */
function getValidTrades(pair) {
  const all = loadLedger();
  return all
    .filter((t) =>
      t.outcome !== 'PENDING' &&
      t.simulated !== true &&
      t.isSimulated !== true &&
      t.excludeFromLearning !== true &&
      t.side !== 'FLASHLOAN' &&
      t.costUsd !== null && t.costUsd !== undefined && // 2026-10-03: fee-inclusive rows only
      (!pair || t.pair === pair)
    )
    .slice(-LOOKBACK_TRADES);
}

function winRateByHourUTC(trades) {
  const buckets = {};
  for (const t of trades) {
    if (!t.timestamp) continue;
    const h = new Date(t.timestamp).getUTCHours();
    buckets[h] = buckets[h] || { count: 0, wins: 0 };
    buckets[h].count++;
    if (t.outcome === 'WIN') buckets[h].wins++;
  }
  const out = {};
  for (const [h, b] of Object.entries(buckets)) {
    out[h] = { count: b.count, winRate: +((b.wins / b.count) * 100).toFixed(1) };
  }
  return out;
}

/**
 * Evidence-gated caution signal for the CURRENT UTC hour, for one pair.
 * hasSignal:false (silently) until this hour has MIN_TRADES_PER_BUCKET+
 * real closed trades for this pair.
 */
function getTimingGuidance(pair, nowUtcHour = new Date().getUTCHours()) {
  const trades = getValidTrades(pair);
  const byHour = winRateByHourUTC(trades);
  const thisHour = byHour[nowUtcHour];
  if (!thisHour || thisHour.count < MIN_TRADES_PER_BUCKET) {
    return {
      hasSignal: false,
      reason: `Only ${thisHour?.count || 0} closed trades so far in UTC hour ${nowUtcHour} for ${pair} (need ${MIN_TRADES_PER_BUCKET}+) — no timing signal yet.`,
    };
  }
  const caution = thisHour.winRate <= CAUTION_WIN_RATE_PCT;
  return {
    hasSignal: true,
    caution,
    winRate: thisHour.winRate,
    tradeCount: thisHour.count,
    reason: caution
      ? `UTC hour ${nowUtcHour} has a ${thisHour.winRate}% real win rate over ${thisHour.count} trades for ${pair} — a historically weaker window, raising the confidence bar this cycle (not blocking).`
      : `UTC hour ${nowUtcHour}: ${thisHour.winRate}% real win rate over ${thisHour.count} trades for ${pair} — within normal range.`,
  };
}

/**
 * Same idea, sliced by trade SIDE (BUY vs SELL) instead of hour.
 */
function getDirectionGuidance(pair, side) {
  const normSide = String(side || '').toUpperCase();
  const trades = getValidTrades(pair).filter((t) => String(t.side || '').toUpperCase() === normSide);
  if (trades.length < MIN_TRADES_PER_BUCKET) {
    return {
      hasSignal: false,
      reason: `Only ${trades.length} closed ${normSide} trades so far for ${pair} (need ${MIN_TRADES_PER_BUCKET}+) — no direction signal yet.`,
    };
  }
  const wins = trades.filter((t) => t.outcome === 'WIN').length;
  const winRate = +((wins / trades.length) * 100).toFixed(1);
  const caution = winRate <= CAUTION_WIN_RATE_PCT;
  return {
    hasSignal: true,
    caution,
    winRate,
    tradeCount: trades.length,
    reason: caution
      ? `${normSide} trades on ${pair} have a ${winRate}% real win rate over ${trades.length} trades — historically weaker, raising the confidence bar this cycle (not blocking).`
      : `${normSide} trades on ${pair}: ${winRate}% real win rate over ${trades.length} trades — within normal range.`,
  };
}

/** Plain-code summary stats for one pair (or all pairs if omitted) — used by
 * a future dashboard panel, never fed back into a live decision by itself.
 * Kept here so all "what has this bot actually learned" math lives in one
 * auditable place. */
function computeStats(pair) {
  const trades = getValidTrades(pair);
  if (!trades.length) return null;
  const wins = trades.filter((t) => t.outcome === 'WIN');
  const losses = trades.filter((t) => t.outcome === 'LOSS');
  let maxStreak = 0;
  let curStreak = 0;
  for (const t of trades) {
    if (t.outcome === 'LOSS') {
      curStreak++;
      maxStreak = Math.max(maxStreak, curStreak);
    } else {
      curStreak = 0;
    }
  }
  const gains = wins.reduce((s, t) => s + (t.pnlUsd || 0), 0);
  const lossSum = Math.abs(losses.reduce((s, t) => s + (t.pnlUsd || 0), 0));
  const lossHourCountsUTC = {};
  for (const t of losses) {
    if (!t.timestamp) continue;
    const h = new Date(t.timestamp).getUTCHours();
    lossHourCountsUTC[h] = (lossHourCountsUTC[h] || 0) + 1;
  }
  return {
    tradeCount: trades.length,
    winRate: +((wins.length / trades.length) * 100).toFixed(1),
    profitFactor: lossSum === 0 ? (gains > 0 ? Infinity : 0) : +(gains / lossSum).toFixed(2),
    maxConsecutiveLosses: maxStreak,
    lossHourCountsUTC,
  };
}

module.exports = {
  getTimingGuidance,
  getDirectionGuidance,
  computeStats,
  getValidTrades,
  MIN_TRADES_PER_BUCKET,
  CAUTION_WIN_RATE_PCT,
};
