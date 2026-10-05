/**
 * src/risk/edgeMonitor.js -- self-healing edge check.
 * Ported 2026-09-27 from F:\aitradingagent2\src\risk\edgeMonitor.js (Claude's
 * merge report of 2026-09-14 flagged this as a validated improvement not yet
 * carried over -- see claude/session-2026-09-14-merge-report.md). Logic is
 * unchanged from the original; only the ledger accessor is swapped for this
 * project's own data/trade_ledger.json (src/risk/tradeLedger.js) instead of
 * aitradingagent2's src/ledger/paperLedger.js, since the two projects use
 * different ledger shapes.
 *
 * What it does: watches the trailing closed trades this bot has ACTUALLY
 * made (real fills, real outcomes -- never a backtest number) and reports
 * whether NEW entries for a token should be auto-suppressed because the
 * live profit factor has degraded, or because of a live losing streak.
 * This is wired into checkRiskGate() in riskGate.js as an ADDITIONAL veto
 * check -- it can only ever block a trade the existing gates would have
 * allowed, never approve one they would have blocked, so it cannot loosen
 * MIN_CONFIDENCE or the majority-agreement requirement. It never touches
 * positions that are already open -- the ATR stop / TTL logic in riskGate.js
 * still manages those.
 *
 * Fully automatic: runs on every checkRiskGate() call, no manual trigger.
 * The only configurable knobs are the four env vars below (Alan's
 * "settings" exception).
 */
'use strict';
const { loadLedger } = require('./tradeLedger');

const MIN_TRADES_TO_EVALUATE = Number(process.env.EDGE_MONITOR_MIN_TRADES || 15);
const LOOKBACK_TRADES = Number(process.env.EDGE_MONITOR_LOOKBACK || 30);
const MIN_PROFIT_FACTOR = Number(process.env.EDGE_MONITOR_MIN_PF || 0.9);

/**
 * Real, resolved closed trades for one symbol, oldest-to-newest, most
 * recent `limit`. Applies the same exclusions as tradeLedger.getPerformanceStats
 * (PENDING / simulated / excludeFromLearning / FLASHLOAN) so this can't be
 * fooled by the same "phantom profit" bug class fixed there on 2026-09-15.
 */
function getClosedTrades(symbol, limit) {
  const clean = String(symbol).split('/')[0].toUpperCase();
  const ledger = loadLedger();
  const resolved = ledger.filter(t =>
    (t.symbol || '').toUpperCase() === clean &&
    t.outcome !== 'PENDING' &&
    t.simulated !== true &&
    t.isSimulated !== true &&
    t.excludeFromLearning !== true &&
    t.side !== 'FLASHLOAN' &&
    t.costUsd !== null && t.costUsd !== undefined // 2026-10-03: fee-inclusive rows only
  );
  return resolved.slice(-limit);
}

function profitFactor(trades) {
  const gains = trades.filter((t) => t.pnlUsd > 0).reduce((sum, t) => sum + t.pnlUsd, 0);
  const losses = Math.abs(trades.filter((t) => t.pnlUsd < 0).reduce((sum, t) => sum + t.pnlUsd, 0));
  if (losses === 0) return gains > 0 ? Infinity : 0;
  return gains / losses;
}

/**
 * @param {string} symbol
 * @returns {{ suppressed: boolean, reason: string, tradeCount: number, pf: number|null }}
 */
function checkEdge(symbol) {
  const trades = getClosedTrades(symbol, LOOKBACK_TRADES);
  if (trades.length < MIN_TRADES_TO_EVALUATE) {
    return {
      suppressed: false,
      reason: `Only ${trades.length} live closed trades so far for ${symbol} (need ${MIN_TRADES_TO_EVALUATE}+ before this self-healing check activates).`,
      tradeCount: trades.length,
      pf: null,
    };
  }

  const pf = profitFactor(trades);
  if (pf < MIN_PROFIT_FACTOR) {
    return {
      suppressed: true,
      reason: `Trailing ${trades.length}-trade LIVE profit factor for ${symbol} (${pf.toFixed(2)}) has dropped below the self-healing floor (${MIN_PROFIT_FACTOR}) -- auto-suppressing NEW entries until it recovers. Existing open positions are unaffected.`,
      tradeCount: trades.length,
      pf,
    };
  }

  return {
    suppressed: false,
    reason: `Trailing ${trades.length}-trade live profit factor for ${symbol}: ${pf.toFixed(2)} -- within the healthy range.`,
    tradeCount: trades.length,
    pf,
  };
}

// Loss-streak cooldown -- a second, faster-triggering self-healing check
// alongside the profit-factor one above: pauses new entries after N
// consecutive live losses rather than only reacting once profit factor has
// already degraded across many trades. Purely a COOLDOWN (temporary, lifts
// itself on the next WIN or once old losses roll off), never a permanent
// suppression, and never touches an already-open position.
const LOSS_STREAK_THRESHOLD = Number(process.env.LOSS_STREAK_THRESHOLD || 3);
const LOSS_STREAK_COOLDOWN_TRADES = Number(process.env.LOSS_STREAK_COOLDOWN_TRADES || 3);

/**
 * @param {string} symbol
 * @returns {{ suppressed: boolean, reason: string, streak: number }}
 */
function checkLossStreak(symbol) {
  const trades = getClosedTrades(symbol, LOSS_STREAK_THRESHOLD + LOSS_STREAK_COOLDOWN_TRADES);
  if (trades.length < LOSS_STREAK_THRESHOLD) {
    return { suppressed: false, reason: 'Not enough closed trades yet to evaluate a loss streak.', streak: 0 };
  }

  let streak = 0;
  for (let i = trades.length - 1; i >= 0; i--) {
    if (trades[i].outcome === 'LOSS') streak++;
    else break;
  }

  if (streak >= LOSS_STREAK_THRESHOLD) {
    return {
      suppressed: true,
      reason: `${streak} consecutive real losing trades for ${symbol} -- pausing NEW entries for a cooldown ` +
        `(lifts automatically after the next ${LOSS_STREAK_COOLDOWN_TRADES} trades roll off, or immediately on the next WIN). ` +
        `Existing open positions are unaffected.`,
      streak,
    };
  }

  return { suppressed: false, reason: `Trailing loss streak for ${symbol}: ${streak} (threshold ${LOSS_STREAK_THRESHOLD}).`, streak };
}

module.exports = {
  checkEdge, MIN_TRADES_TO_EVALUATE, LOOKBACK_TRADES, MIN_PROFIT_FACTOR,
  checkLossStreak, LOSS_STREAK_THRESHOLD, LOSS_STREAK_COOLDOWN_TRADES,
};
