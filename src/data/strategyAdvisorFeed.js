/**
 * strategyAdvisorFeed.js — 2026-10-05
 * Drop-in replacement for the retired TradingKit feed (src/data/tradingKitFeed.js,
 * scripts/tradingkit_analyst.js — removed per Alan's instruction: "remove
 * tradingkit analyst, use a single agent tradingview strategy advisor/picker").
 *
 * Reads the cache written by scripts/strategy_advisor.js, which continually
 * picks the best-performing strategy (across all 4 presets in
 * pineScriptGenerator.js, plus any sourced from GitHub/Twitter via
 * strategySourcer.js) for each target pair, backtests it with the real
 * engine (backtestEngine.js over real historical candles), and writes the
 * result here AND into the learned-strategy / trade memory
 * (learned_strategies.json, strategy/strategy_memory.json via
 * strategyLearningAgent.saveLearnedStrategy).
 *
 * Same cache-read contract as the old tradingKitFeed.fetchSignal(): the fast
 * consensus/debate loop in src/orchestrator/index.js only ever reads this
 * file — it never triggers a live backtest inline.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const SIGNAL_CACHE_PATH = path.resolve(__dirname, '../../data/strategy_advisor_signals.json');
const SIGNAL_MAX_AGE_MS = Number(process.env.STRATEGY_ADVISOR_SIGNAL_MAX_AGE_MS || 6 * 60 * 60 * 1000); // 6h
const ENABLED = process.env.STRATEGY_ADVISOR_ENABLED !== 'false';

function _readCache() {
  try { return JSON.parse(fs.readFileSync(SIGNAL_CACHE_PATH, 'utf8')); } catch { return null; }
}

async function fetchSignal(symbol) {
  if (!ENABLED) return null;
  const cache = _readCache();
  const base = String(symbol || '').replace(/[/-].*$/, '').toUpperCase();
  const entry = cache?.[base];
  if (!entry) return null;
  if (Date.now() - entry.generatedAt > SIGNAL_MAX_AGE_MS) return null;
  return entry;
}

async function checkHealth() {
  const cache = _readCache();
  if (!cache) return { ok: false, error: 'strategy-advisor has not written a cache yet' };
  const pairs = Object.keys(cache);
  return { ok: true, pairs: pairs.length, lastGeneratedAt: pairs.length ? Math.max(...pairs.map(p => cache[p].generatedAt || 0)) : null };
}

async function enrichMarketData(pair, baseMarketData = {}) {
  if (!ENABLED) return baseMarketData;
  try {
    const signal = await fetchSignal(pair);
    if (!signal) return baseMarketData;
    return {
      ...baseMarketData,
      strategyAdvisorSignal: {
        action: signal.action,
        confidence: signal.confidence,
        reason: signal.reason,
        strategyType: signal.strategyType,
        netProfitPct: signal.netProfitPct,
        winRatePct: signal.winRatePct,
        sharpeRatio: signal.sharpeRatio,
        source: signal.source || 'internal',
        generatedAt: signal.generatedAt,
      },
    };
  } catch (err) {
    logger.debug(`[StrategyAdvisorFeed] enrichMarketData failed for ${pair}: ${err.message}`);
    return baseMarketData;
  }
}

// Kept as no-op stubs purely so dashboard/server.js's existing endpoints
// (candles/indicators proxies) don't need extra branching — this feed,
// like the TradingKit one before it, is a signal source, not a market-data
// source; real candles come from src/data/marketData.js.
async function fetchCandles() { return null; }
async function fetchIndicators() { return null; }
async function fetchMarketOverview() { return null; }

module.exports = {
  fetchSignal, checkHealth, enrichMarketData,
  fetchCandles, fetchIndicators, fetchMarketOverview,
  SIGNAL_CACHE_PATH, ENABLED,
};
