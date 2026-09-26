/**
 * Self-Learning Engine from Lost Trades (LossLearner)
 * ===================================================
 * Institutional Post-Mortem Analysis & Negative Pattern Memory.
 * Evaluates why trades failed, extracts deterministic failure traps,
 * maintains decaying negative pattern memory, and applies pre-trade
 * filters to protect and maximize hit rate.
 *
 * 2026-09-26 (Claude): added a content-based dedupe guard in recordLossPostMortem().
 * A caller bug elsewhere (learningAgent.js calling this with positional args instead of
 * an options object) had been writing dozens of byte-for-byte identical placeholder
 * records to data/lost_trades_memory.json. That caller bug is fixed, but this guard stays
 * as defense-in-depth: any future bug that re-submits the exact same diagnosis (same
 * symbol/trapType/entry/exit/pnl/diagnostic) is now skipped instead of piling up, so the
 * memory file — and anything that weights trapType frequency from it — can't be polluted
 * by repeat/duplicate writes again.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve(__dirname, '../../data');
const LOSS_MEMORY_FILE = path.join(DATA_DIR, 'lost_trades_memory.json');

const DECAY_DAYS = 30; // lessons decay over 30 days
const PRUNE_DAYS = 60; // pruned after 60 days

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOSS_MEMORY_FILE)) {
    fs.writeFileSync(LOSS_MEMORY_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

/**
 * Load lost trade memory from disk with automatic time decay
 */
function loadLossMemory() {
  ensureStorage();
  try {
    const raw = fs.readFileSync(LOSS_MEMORY_FILE, 'utf8');
    const records = JSON.parse(raw);
    const now = Date.now();
    const pruneMs = PRUNE_DAYS * 86400000;
    const halfMs = DECAY_DAYS * 86400000;

    const filtered = records
      .filter(r => (now - new Date(r.timestamp).getTime()) < pruneMs)
      .map(r => {
        const age = now - new Date(r.timestamp).getTime();
        const weight = age > halfMs ? 0.5 : 1.0;
        return { ...r, activeWeight: weight };
      });

    return filtered;
  } catch (e) {
    return [];
  }
}

/**
 * Save updated lost trade memory to disk
 */
function saveLossMemory(records) {
  ensureStorage();
  try {
    const trimmed = records.slice(-100); // keep last 100 post-mortems
    fs.writeFileSync(LOSS_MEMORY_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (e) {
    logger.warn(`Failed to save loss memory: ${e.message}`);
  }
}

/**
 * True if `records` already contains a post-mortem with the same diagnosis content
 * as `candidate` (ignoring id/timestamp/activeWeight, which always differ).
 */
function isDuplicatePostMortem(records, candidate) {
  return records.some(r =>
    r.symbol === candidate.symbol &&
    r.trapType === candidate.trapType &&
    r.entryPrice === candidate.entryPrice &&
    r.exitPrice === candidate.exitPrice &&
    r.pnlUsd === candidate.pnlUsd &&
    r.diagnostic === candidate.diagnostic
  );
}

/**
 * Perform Automated Post-Mortem Root Cause Analysis on a losing trade
 *
 * @param {Object} tradeParams - Info about the losing trade
 * @returns {Object} Post-mortem diagnostic report
 */
function recordLossPostMortem({
  symbol,
  pair,
  side = 'BUY',
  entryPrice,
  exitPrice,
  pnlUsd = 0,
  pnlPct = 0,
  marketData = {},
  btcBenchmark = {},
  reason = '',
}) {
  const cleanSymbol = (symbol || pair || 'CRYPTO').split('/')[0].toUpperCase();
  const price = marketData?.price?.price || exitPrice || 100;
  const ind = marketData?.indicators || {};
  const rsi = ind.rsi14 || 50;
  const ema20 = ind.ema20 || price;
  const ema50 = ind.ema50 || price;
  const volRatio = ind.volumeRatio || 1.0;
  const btcChange = btcBenchmark?.change24h || 0.0;
  const btcTrend = btcBenchmark?.trend || 'NEUTRAL';

  // 1. Identify Root Cause Failure Trap
  let trapType = 'UNKNOWN_REGIME_SHIFT';
  let severity = 'MODERATE';
  let diagnostic = 'Trade failed to achieve expected continuation target.';
  let ruleFilter = '';

  const distEma50Pct = ema50 > 0 ? ((price - ema50) / ema50) * 100 : 0;

  if (side === 'BUY' && (btcChange < -2.0 || btcTrend === 'BEARISH_CONTRACTION')) {
    trapType = 'BTC_HEADWIND_DRAG';
    severity = 'HIGH';
    diagnostic = `Long entered while BTC was dumping (${btcChange}% 24h, ${btcTrend}). Macro market drag overwhelmed individual setup.`;
    ruleFilter = 'DO_NOT_BUY_WHEN_BTC_DUMPING';
  } else if (side === 'BUY' && distEma50Pct > 4.5) {
    trapType = 'BULL_TRAP_OVEREXTENDED';
    severity = 'HIGH';
    diagnostic = `Chased price +${distEma50Pct.toFixed(1)}% overextended above 50-EMA without institutional pullback support.`;
    ruleFilter = 'AVOID_CHASING_OVEREXTENDED_EMA50';
  } else if (side === 'BUY' && rsi > 68) {
    trapType = 'OVERBOUGHT_EXHAUSTION';
    severity = 'HIGH';
    diagnostic = `Bought into RSI overbought exhaustion (${rsi.toFixed(1)}). Sellers absorbed breakout liquidity.`;
    ruleFilter = 'AVOID_LONG_WHEN_RSI_OVERBOUGHT';
  } else if (side === 'SELL' && rsi < 32) {
    trapType = 'OVERSOLD_BEAR_TRAP';
    severity = 'HIGH';
    diagnostic = `Short entered into oversold bounce territory (RSI ${rsi.toFixed(1)}).`;
    ruleFilter = 'AVOID_SHORT_WHEN_RSI_OVERSOLD';
  } else if (volRatio < 1.1) {
    trapType = 'LOW_VOLUME_FAKEOUT';
    severity = 'MEDIUM';
    diagnostic = `Breakout attempted on low volume (${volRatio}x SMA). Failed to find institutional follow-through.`;
    ruleFilter = 'REQUIRE_MIN_VOLUME_EXPANSION_1_25X';
  } else if (side === 'BUY' && ema20 < ema50) {
    trapType = 'COUNTER_TREND_DEATH_CROSS';
    severity = 'HIGH';
    diagnostic = `Long initiated against prevailing 20/50 Death Cross trend alignment.`;
    ruleFilter = 'REQUIRE_GOLDEN_EMA_ALIGNMENT_FOR_LONGS';
  } else {
    trapType = 'VOLATILITY_STOP_SWEEP';
    severity = 'MEDIUM';
    diagnostic = `Normal volatility wick swept stop-loss before target was reached. Check ATR buffer sizing.`;
    ruleFilter = 'WIDEN_ATR_STOP_BUFFER';
  }

  const postMortem = {
    id: `LOSS-${Date.now()}`,
    timestamp: new Date().toISOString(),
    symbol: cleanSymbol,
    side,
    entryPrice,
    exitPrice,
    pnlUsd,
    pnlPct,
    trapType,
    severity,
    diagnostic,
    ruleFilter,
    marketSnapshot: {
      rsi,
      distEma50Pct: parseFloat(distEma50Pct.toFixed(2)),
      emaGolden: ema20 >= ema50,
      volRatio,
      btcChange24h: btcChange,
    },
    activeWeight: 1.0,
  };

  const existing = loadLossMemory();
  if (isDuplicatePostMortem(existing, postMortem)) {
    logger.info(`🧠 [LossLearner] Skipped duplicate post-mortem for ${cleanSymbol} (${side}): [${trapType}] already recorded.`);
    return postMortem;
  }
  existing.push(postMortem);
  saveLossMemory(existing);

  logger.warn(
    `🧠 [LossLearner] Learned from lost trade on ${cleanSymbol} (${side}): [${trapType}] ${diagnostic} -> Filter Rule Created: ${ruleFilter}`
  );

  return postMortem;
}

/**
 * Evaluate Candidate Trade Setup Against Negative Pattern Memory
 * Returns match status, penalty, and warning reason if setup matches past losses
 *
 * @param {string} symbol
 * @param {string} signal - 'BUY' or 'SELL'
 * @param {Object} marketData
 * @param {Object} btcBenchmark
 * @returns {Object} Evaluation report
 */
function evaluateNegativePatterns(symbol, signal = 'BUY', marketData = {}, btcBenchmark = {}) {
  const cleanSymbol = symbol.split('/')[0].toUpperCase();
  const memory = loadLossMemory();

  if (memory.length === 0) {
    return {
      hasNegativePatternMatch: false,
      confidencePenalty: 0.0,
      vetoRecommended: false,
      matches: [],
      reason: 'No negative pattern traps detected.',
    };
  }

  const price = marketData?.price?.price || 100;
  const ind = marketData?.indicators || {};
  const rsi = ind.rsi14 || 50;
  const ema20 = ind.ema20 || price;
  const ema50 = ind.ema50 || price;
  const volRatio = ind.volumeRatio || 1.0;
  const distEma50Pct = ema50 > 0 ? ((price - ema50) / ema50) * 100 : 0;
  const btcChange = btcBenchmark?.change24h || 0.0;
  const btcTrend = btcBenchmark?.trend || 'NEUTRAL';

  const matches = [];

  for (const loss of memory) {
    let matched = false;

    if (loss.ruleFilter === 'DO_NOT_BUY_WHEN_BTC_DUMPING') {
      if (signal === 'BUY' && (btcChange < -1.8 || btcTrend === 'BEARISH_CONTRACTION')) {
        matched = true;
      }
    } else if (loss.ruleFilter === 'AVOID_CHASING_OVEREXTENDED_EMA50') {
      if (signal === 'BUY' && distEma50Pct > 4.2) {
        matched = true;
      }
    } else if (loss.ruleFilter === 'AVOID_LONG_WHEN_RSI_OVERBOUGHT') {
      if (signal === 'BUY' && rsi > 67) {
        matched = true;
      }
    } else if (loss.ruleFilter === 'AVOID_SHORT_WHEN_RSI_OVERSOLD') {
      if (signal === 'SELL' && rsi < 33) {
        matched = true;
      }
    } else if (loss.ruleFilter === 'REQUIRE_MIN_VOLUME_EXPANSION_1_25X') {
      if (volRatio < 1.15) {
        matched = true;
      }
    } else if (loss.ruleFilter === 'REQUIRE_GOLDEN_EMA_ALIGNMENT_FOR_LONGS') {
      if (signal === 'BUY' && ema20 < ema50) {
        matched = true;
      }
    }

    if (matched && !matches.some(m => m.ruleFilter === loss.ruleFilter)) {
      matches.push({
        trapType: loss.trapType,
        ruleFilter: loss.ruleFilter,
        weight: loss.activeWeight || 1.0,
        lesson: loss.diagnostic,
      });
    }
  }

  if (matches.length > 0) {
    const totalPenalty = Math.min(0.35, matches.reduce((sum, m) => sum + (0.12 * m.weight), 0));
    const isSevere = matches.some(m => m.trapType === 'BTC_HEADWIND_DRAG' || m.trapType === 'BULL_TRAP_OVEREXTENDED');
    const reasons = matches.map(m => `[${m.trapType}] ${m.lesson}`).join('; ');

    return {
      hasNegativePatternMatch: true,
      confidencePenalty: parseFloat(totalPenalty.toFixed(2)),
      vetoRecommended: isSevere && totalPenalty >= 0.24,
      matches,
      reason: `⚠️ Self-Learning Alert: Setup matches ${matches.length} known loss traps: ${reasons}`,
    };
  }

  return {
    hasNegativePatternMatch: false,
    confidencePenalty: 0.0,
    vetoRecommended: false,
    matches: [],
    reason: 'Negative pattern filter passed — no historical traps detected.',
  };
}

/**
 * Get Top Active Learned Lessons for LLM Context & Prompts
 */
function getLostTradeLessons(limit = 5) {
  const memory = loadLossMemory();
  const trapCounts = {};

  for (const m of memory) {
    if (!trapCounts[m.trapType]) {
      trapCounts[m.trapType] = { count: 0, ruleFilter: m.ruleFilter, latestDiagnostic: m.diagnostic };
    }
    trapCounts[m.trapType].count++;
  }

  const sorted = Object.entries(trapCounts)
    .map(([trap, data]) => ({
      trapType: trap,
      frequency: data.count,
      ruleFilter: data.ruleFilter,
      diagnostic: data.latestDiagnostic,
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, limit);

  return sorted;
}

module.exports = {
  recordLossPostMortem,
  evaluateNegativePatterns,
  getLostTradeLessons,
  loadLossMemory,
};
