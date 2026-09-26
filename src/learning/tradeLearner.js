/**
 * TradeLearner — Win + Loss Memory (extends LossLearner)
 * ========================================================================
 * Added 2026-09-26 at Alan's request, after researching Tauric Research's
 * TradingAgents project (github.com/TauricResearch/TradingAgents). Its
 * self-learning memory logs BOTH wins and losses as plain-text lessons and
 * re-injects the most recent same-symbol + a few cross-symbol entries into
 * the next analysis prompt — no embeddings, just recency + symbol matching.
 * That's a genuine gap here: lossLearner.js (unchanged, still fully in
 * effect for the existing negative-pattern penalty/veto used by
 * bullAgent.js / bearAgent.js / expertTraderAgent.js / consensus.js) only
 * ever recorded losses, so the debate/strategy prompts never saw *why* a
 * trade worked, only why past ones failed.
 *
 * This file is purely additive:
 *  - recordWinPostMortem() / getWonTradeLessons() mirror lossLearner.js's
 *    loss-side functions exactly, writing to their own file
 *    (data/won_trades_memory.json) with the same dedupe/decay/prune rules.
 *  - getTradeLessons() is the new Tauric-style combined retrieval: recent
 *    same-symbol win+loss entries plus a few recent cross-symbol lessons,
 *    formatted as ready-to-inject prompt text.
 *  - Nothing here touches evaluateNegativePatterns() (the confidence
 *    penalty / veto logic used by the agents above) or any consensus/live
 *    gate threshold. Those stay exactly as they were.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const lossLearner = require('./lossLearner');

const DATA_DIR = path.resolve(__dirname, '../../data');
const WIN_MEMORY_FILE = path.join(DATA_DIR, 'won_trades_memory.json');

const DECAY_DAYS = 30;
const PRUNE_DAYS = 60;

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(WIN_MEMORY_FILE)) {
    fs.writeFileSync(WIN_MEMORY_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

function loadWinMemory() {
  ensureStorage();
  try {
    const raw = fs.readFileSync(WIN_MEMORY_FILE, 'utf8');
    const records = JSON.parse(raw);
    const now = Date.now();
    const pruneMs = PRUNE_DAYS * 86400000;
    const halfMs = DECAY_DAYS * 86400000;

    return records
      .filter(r => (now - new Date(r.timestamp).getTime()) < pruneMs)
      .map(r => {
        const age = now - new Date(r.timestamp).getTime();
        const weight = age > halfMs ? 0.5 : 1.0;
        return { ...r, activeWeight: weight };
      });
  } catch (e) {
    return [];
  }
}

function saveWinMemory(records) {
  ensureStorage();
  try {
    const trimmed = records.slice(-100); // same cap as lossLearner.js
    fs.writeFileSync(WIN_MEMORY_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (e) {
    logger.warn(`Failed to save win memory: ${e.message}`);
  }
}

function isDuplicateWinRecord(records, candidate) {
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
 * Diagnose WHY a trade won — the positive-side mirror of lossLearner.js's
 * trap taxonomy. Same inputs as recordLossPostMortem() so both can be
 * called from the same call site with the same market snapshot.
 */
function recordWinPostMortem({
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
  const distEma50Pct = ema50 > 0 ? ((price - ema50) / ema50) * 100 : 0;

  let trapType = 'CLEAN_TREND_EXECUTION';
  let diagnostic = 'Trade reached its target with no notable adverse condition.';

  if (side === 'BUY' && (btcChange > 2.0 || btcTrend === 'BULLISH_EXPANSION')) {
    trapType = 'BTC_TAILWIND_ASSIST';
    diagnostic = `Long entered while BTC was rallying (${btcChange}% 24h, ${btcTrend}). Macro tailwind carried the setup.`;
  } else if (side === 'SELL' && (btcChange < -2.0 || btcTrend === 'BEARISH_CONTRACTION')) {
    trapType = 'BTC_TAILWIND_ASSIST';
    diagnostic = `Short entered while BTC was dumping (${btcChange}% 24h, ${btcTrend}). Macro tailwind carried the setup.`;
  } else if (volRatio >= 1.25) {
    trapType = 'VOLUME_CONFIRMED_BREAKOUT';
    diagnostic = `Breakout confirmed by real volume expansion (${volRatio}x SMA) - institutional follow-through present.`;
  } else if (side === 'BUY' && ema20 >= ema50 && rsi >= 45 && rsi <= 65) {
    trapType = 'GOLDEN_EMA_HEALTHY_MOMENTUM';
    diagnostic = `Long aligned with 20/50 Golden Cross trend, entered at healthy (non-overbought) RSI ${rsi.toFixed(1)}.`;
  } else if (side === 'SELL' && ema20 <= ema50 && rsi >= 35 && rsi <= 55) {
    trapType = 'DEATH_CROSS_HEALTHY_MOMENTUM';
    diagnostic = `Short aligned with 20/50 Death Cross trend, entered at healthy (non-oversold) RSI ${rsi.toFixed(1)}.`;
  } else if (side === 'BUY' && distEma50Pct >= 0 && distEma50Pct <= 2.5) {
    trapType = 'PULLBACK_ENTRY_NOT_CHASED';
    diagnostic = `Long entered close to the 50-EMA (+${distEma50Pct.toFixed(1)}%) rather than chasing an extended move.`;
  }

  const postMortem = {
    id: `WIN-${Date.now()}`,
    timestamp: new Date().toISOString(),
    symbol: cleanSymbol,
    side,
    entryPrice,
    exitPrice,
    pnlUsd,
    pnlPct,
    trapType,
    diagnostic,
    outcome: 'WIN',
    reason,
    marketSnapshot: {
      rsi,
      distEma50Pct: parseFloat(distEma50Pct.toFixed(2)),
      emaGolden: ema20 >= ema50,
      volRatio,
      btcChange24h: btcChange,
    },
    activeWeight: 1.0,
  };

  const existing = loadWinMemory();
  if (isDuplicateWinRecord(existing, postMortem)) {
    logger.info(`🧠 [TradeLearner] Skipped duplicate win record for ${cleanSymbol} (${side}): [${trapType}] already recorded.`);
    return postMortem;
  }
  existing.push(postMortem);
  saveWinMemory(existing);

  logger.info(`🧠 [TradeLearner] Learned from winning trade on ${cleanSymbol} (${side}): [${trapType}] ${diagnostic}`);

  return postMortem;
}

/**
 * Frequency-ranked winning patterns — mirrors lossLearner.getLostTradeLessons().
 */
function getWonTradeLessons(limit = 5) {
  const memory = loadWinMemory();
  const trapCounts = {};

  for (const m of memory) {
    if (!trapCounts[m.trapType]) {
      trapCounts[m.trapType] = { count: 0, latestDiagnostic: m.diagnostic };
    }
    trapCounts[m.trapType].count++;
  }

  return Object.entries(trapCounts)
    .map(([trap, data]) => ({
      trapType: trap,
      frequency: data.count,
      diagnostic: data.latestDiagnostic,
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, limit);
}

/**
 * Tauric-style combined retrieval for prompt injection: the most recent
 * `symbolLimit` win+loss records for `symbol`, plus `crossLimit` recent
 * lessons from OTHER symbols, sorted by recency, with a ready-to-paste
 * text block. Pure retrieval - no numeric confidence adjustment, no gate
 * interaction. Safe to call from any prompt-building code without
 * touching evaluateNegativePatterns() or the live-funds gate.
 */
function getTradeLessons({ symbol = '', symbolLimit = 5, crossLimit = 3 } = {}) {
  const cleanSymbol = symbol ? symbol.split('/')[0].toUpperCase() : '';
  const all = [
    ...lossLearner.loadLossMemory().map(r => ({ ...r, outcome: 'LOSS' })),
    ...loadWinMemory().map(r => ({ ...r, outcome: r.outcome || 'WIN' })),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const sameSymbol = cleanSymbol
    ? all.filter(r => r.symbol === cleanSymbol).slice(0, symbolLimit)
    : [];
  const crossSymbol = cleanSymbol
    ? all.filter(r => r.symbol !== cleanSymbol).slice(0, crossLimit)
    : all.slice(0, crossLimit);

  const fmt = (r) => {
    const pnlStr = typeof r.pnlUsd === 'number' ? `$${r.pnlUsd.toFixed(2)}` : 'n/a';
    const pctStr = typeof r.pnlPct === 'number' ? ` (${(r.pnlPct * 100).toFixed(1)}%)` : '';
    const date = (r.timestamp || '').slice(0, 10);
    return `- [${r.outcome}] ${date} ${r.symbol} ${r.side || ''}: ${r.diagnostic} -> ${pnlStr}${pctStr}`;
  };

  const lines = [];
  if (sameSymbol.length) {
    lines.push(`Recent trade history for ${cleanSymbol}:`);
    lines.push(...sameSymbol.map(fmt));
  }
  if (crossSymbol.length) {
    lines.push(sameSymbol.length ? '\nCross-symbol lessons:' : 'Recent cross-symbol lessons:');
    lines.push(...crossSymbol.map(fmt));
  }

  return {
    symbol: cleanSymbol,
    sameSymbolRecords: sameSymbol,
    crossSymbolRecords: crossSymbol,
    contextText: lines.length ? lines.join('\n') : 'No trade memory yet for this symbol or recent history.',
  };
}

module.exports = {
  // Loss-side, re-exported unchanged from lossLearner.js so callers can
  // migrate to one require('./tradeLearner') without breaking anything.
  recordLossPostMortem: lossLearner.recordLossPostMortem,
  evaluateNegativePatterns: lossLearner.evaluateNegativePatterns,
  getLostTradeLessons: lossLearner.getLostTradeLessons,
  loadLossMemory: lossLearner.loadLossMemory,
  // Win-side, new
  recordWinPostMortem,
  getWonTradeLessons,
  loadWinMemory,
  // Combined Tauric-style retrieval, new
  getTradeLessons,
};
