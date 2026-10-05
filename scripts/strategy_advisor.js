/**
 * AiTradingAgent — Strategy Advisor / Picker (periodic, isolated job)
 * =====================================================================
 * Replaces scripts/tradingkit_analyst.js (retired 2026-10-05, per Alan's
 * instruction: "remove tradingkit analyst, use a single agent tradingview
 * strategy advisor/picker, seeks new strategies [from the] internet, git,
 * twitter etc, use pine script skills for analysis in strategy, backtest
 * optimising continually after real/demo trades are made, have this agent
 * between data ingestion and getting data from trade memory").
 *
 * Pipeline position — same slot tradingkit-analyst sat in:
 *   [data ingestion: marketData.js] -> THIS -> [trade memory:
 *   learned_strategies.json / strategy/strategy_memory.json, read back out
 *   via src/data/strategyAdvisorFeed.js's cache for the fast consensus loop]
 *
 * Each cycle, for every target token:
 *   1. Checks the trade ledger for real/demo trades closed on this pair
 *      since the last cycle (tradeLedger.js) — a pair with fresh evidence
 *      is logged as higher-priority (continual optimization AFTER trades
 *      are made, not just on a flat timer).
 *   2. Backtests + optimizes ALL FOUR built-in Pine presets
 *      (pineScriptGenerator.js STRATEGY_PRESETS) via the existing real
 *      engine (strategyLearningAgent.optimizeStrategy -> backtestEngine.js,
 *      real historical candles via ccxt) and keeps the best-fitness one —
 *      the "advisor/picker" behaviour.
 *   3. Roughly once a day, also pulls fresh candidate strategies sourced
 *      from GitHub/Twitter (strategySourcer.js) and feeds any an LLM mapped
 *      onto a known preset in as EXTRA parameter candidates for step 2 —
 *      the "seeks new strategies" behaviour. A source with no token
 *      configured contributes nothing and says so once in the log; it
 *      never blocks the core backtest/pick loop.
 *   4. Writes the winning pick to data/strategy_advisor_signals.json (read
 *      by src/data/strategyAdvisorFeed.js) and persists the full backtest
 *      record into learned_strategies.json / strategy/strategy_memory.json
 *      via the existing strategyLearningAgent.saveLearnedStrategy().
 *
 * Same conservative defaults as the rest of this bot: thin/negative
 * evidence -> low-confidence 'hold', never an asserted trade.
 *
 * Usage:
 *   node scripts/strategy_advisor.js          # loop forever (PM2 process)
 *   node scripts/strategy_advisor.js --once   # single cycle, then exit
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { optimizeStrategy } = require('../src/learning/strategyLearningAgent');
const { STRATEGY_PRESETS } = require('../src/learning/pineScriptGenerator');
const { sourceCandidateStrategies } = require('../src/learning/strategySourcer');
const { loadRealTrades } = require('../src/risk/tradeLedger');
const feed = require('../src/data/strategyAdvisorFeed');

const DATA_DIR = path.resolve(__dirname, '../data');
const STATE_PATH = path.join(DATA_DIR, 'strategy_advisor_state.json');
const SIGNALS_PATH = feed.SIGNAL_CACHE_PATH;

const INTERVAL_MS = Number(process.env.STRATEGY_ADVISOR_INTERVAL_S || 14400) * 1000; // 4h, same cadence as the retired tradingkit-analyst
const SOURCING_INTERVAL_MS = Number(process.env.STRATEGY_SOURCING_INTERVAL_S || 86400) * 1000; // 1x/day default
const ITERATIONS_PER_PRESET = Number(process.env.STRATEGY_ADVISOR_ITERATIONS || 8);
const RUN_ONCE = process.argv.includes('--once');

const TOKENS = ['BTC', 'ETH', 'CRO', 'SOL', 'AVAX', 'ARB', 'OP'];
const PRESET_IDS = Object.keys(STRATEGY_PRESETS);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg) { console.log(`[${new Date().toISOString()}] [strategy-advisor] ${msg}`); }

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { sourcedByPreset: {}, lastSourcingAt: 0 }; }
}
function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}
function loadSignals() {
  try { return JSON.parse(fs.readFileSync(SIGNALS_PATH, 'utf8')); } catch { return {}; }
}
function saveSignals(signals) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = SIGNALS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(signals, null, 2));
  fs.renameSync(tmp, SIGNALS_PATH); // atomic swap, same pattern as the retired tradingkit_analyst.js
}

/**
 * Count real (non-simulated, resolved) closed trades on this token since
 * `sinceTs` — used only to log/flag that a fresh optimization pass was
 * triggered by actual trade outcomes, per Alan's "optimising continually
 * after real/demo trades are made" instruction.
 */
function closedTradeCount(token, sinceTs) {
  try {
    const trades = loadRealTrades();
    return trades.filter(t => {
      const sym = String(t.symbol || t.pair || '').toUpperCase();
      if (sym !== token.toUpperCase()) return false;
      const ts = new Date(t.closedAt || t.timestamp).getTime();
      return Number.isFinite(ts) && ts > sinceTs;
    }).length;
  } catch (err) {
    log(`closedTradeCount(${token}) failed: ${err.message}`);
    return 0;
  }
}

// Same default param shape as strategyLearningAgent.js's own grid[0] — the
// safe base that sourced candidate hints get merged onto, so a partial or
// garbled LLM paramHints object can never produce an invalid backtest call.
const BASE_PARAMS = { obLookback: 10, rsiLongMin: 46, rsiLongMax: 68, volMultiplier: 1.4, takeProfitPct: 4.0, stopLossPct: 1.5, atrMultiplier: 1.5 };
const PARAM_BOUNDS = {
  obLookback: [3, 30], rsiLongMin: [20, 60], rsiLongMax: [40, 85],
  volMultiplier: [1.0, 3.0], takeProfitPct: [1.0, 15.0], stopLossPct: [0.5, 8.0], atrMultiplier: [0.5, 4.0],
};

function sanitizeParamHints(hints) {
  const safe = { ...BASE_PARAMS };
  if (!hints || typeof hints !== 'object') return safe;
  for (const [key, bounds] of Object.entries(PARAM_BOUNDS)) {
    const v = Number(hints[key]);
    if (Number.isFinite(v) && v >= bounds[0] && v <= bounds[1]) safe[key] = v;
  }
  return safe;
}

/**
 * Turn a learnedRecord (from strategyLearningAgent.optimizeStrategy) into a
 * conservative {action, confidence, reason} advisory signal. Mirrors the
 * retired tradingkit_analyst.js's "default to hold on thin/negative
 * evidence" rule, plus the 68% win-rate gate already used elsewhere in this
 * bot (bt.gate68Met), plus the isSyntheticData flag added 2026-10-05 to
 * backtestEngine.js — a synthetic-candle backtest can never produce a
 * trusted action here, no matter how good its numbers look.
 */
function deriveAction(rec) {
  const bt = rec.backtest || {};
  const trades = bt.trades || [];
  const MIN_TRADES = 8;

  if (bt.isSyntheticData) {
    return {
      action: 'hold',
      confidence: 0.1,
      reason: `${rec.strategyType} on ${bt.symbol} fell back to SYNTHETIC candles (real exchange `
        + `data unavailable) — never trusted as evidence, holding regardless of backtest numbers.`,
    };
  }

  const hasEdge = bt.gate68Met === true && bt.profitFactor > 1.1 && bt.totalTrades >= MIN_TRADES;
  if (!hasEdge) {
    const why = bt.totalTrades < MIN_TRADES
      ? `only ${bt.totalTrades} backtested trades`
      : `win rate ${bt.winRate}% / profit factor ${bt.profitFactor} below the 68% gate`;
    return {
      action: 'hold',
      confidence: 0.15,
      reason: `${rec.strategyType} on ${bt.symbol}: no reliable edge yet (${why}) — holding.`,
    };
  }

  const buyPnl = trades.filter(t => t.side === 'BUY').reduce((s, t) => s + (t.pnlUsd || 0), 0);
  const sellPnl = trades.filter(t => t.side === 'SELL').reduce((s, t) => s + (t.pnlUsd || 0), 0);
  const action = buyPnl >= sellPnl ? 'buy' : 'sell';
  const confidence = Math.min(0.9, Math.max(0.2, rec.fitnessScore || bt.winRate / 100));

  return {
    action,
    confidence: parseFloat(confidence.toFixed(2)),
    reason: `${rec.strategyType} on ${bt.symbol} (${bt.timeframe}): net ${bt.netProfitPct}%, `
      + `win rate ${bt.winRate}%, profit factor ${bt.profitFactor}, Sharpe ${bt.sharpeRatio} `
      + `over ${bt.totalTrades} trades (68% gate met) — recent trades lean ${action}.`,
  };
}

/**
 * Roughly once a day (SOURCING_INTERVAL_MS), pulls fresh candidates from
 * GitHub/Twitter via strategySourcer.js, groups any that classified onto a
 * known preset, and caches them in state so every cycle in between reuses
 * the same small set rather than re-sourcing on every 4h loop.
 */
async function maybeRefreshSourcedCandidates(state) {
  const now = Date.now();
  if (state.lastSourcingAt && now - state.lastSourcingAt < SOURCING_INTERVAL_MS) {
    return state.sourcedByPreset || {};
  }
  log('sourcing pass due — checking GitHub/Twitter for new candidate strategies...');
  let accepted = [];
  try {
    accepted = await sourceCandidateStrategies({ minConfidence: 0.5 });
  } catch (err) {
    log(`sourcing pass failed: ${err.message} — keeping previous candidates`);
    return state.sourcedByPreset || {};
  }

  const byPreset = {};
  for (const c of accepted) {
    if (!byPreset[c.matchesPreset]) byPreset[c.matchesPreset] = [];
    byPreset[c.matchesPreset].push(sanitizeParamHints(c.paramHints));
  }
  state.sourcedByPreset = byPreset;
  state.lastSourcingAt = now;
  log(`sourcing pass complete — ${accepted.length} candidate(s) accepted across ${Object.keys(byPreset).length} preset(s).`);
  return byPreset;
}

async function runOneToken(token, state, sourcedByPreset) {
  const symbol = `${token}/USDT`;
  const lastRunAt = state[token]?.lastOptimizedAt || 0;
  const freshTrades = closedTradeCount(token, lastRunAt);
  if (freshTrades > 0) {
    log(`${token}: ${freshTrades} real/demo trade(s) closed since last cycle — optimizing on fresh evidence.`);
  }

  let best = null;
  for (const preset of PRESET_IDS) {
    try {
      const rec = await optimizeStrategy({
        symbol,
        timeframe: '15m',
        strategyType: preset,
        iterations: ITERATIONS_PER_PRESET,
        extraCandidates: sourcedByPreset[preset] || [],
      });
      if (!best || (rec.fitnessScore || 0) > (best.fitnessScore || 0)) best = rec;
    } catch (err) {
      log(`${token}/${preset}: optimizeStrategy failed — ${err.message}`);
    }
  }

  if (!best) {
    log(`${token}: all presets failed to optimize this cycle.`);
    return null;
  }

  const signal = deriveAction(best);
  log(`${token}: picked ${best.strategyType} (fitness ${best.fitnessScore}) — `
    + `${signal.action} (conf ${signal.confidence}) — ${signal.reason}`);

  state[token] = { lastOptimizedAt: Date.now(), strategyType: best.strategyType, fitnessScore: best.fitnessScore };

  return {
    ...signal,
    strategyType: best.strategyType,
    netProfitPct: best.backtest.netProfitPct,
    winRatePct: best.backtest.winRate,
    sharpeRatio: best.backtest.sharpeRatio,
    profitFactor: best.backtest.profitFactor,
    totalTrades: best.backtest.totalTrades,
    gate68Met: best.backtest.gate68Met,
    isSyntheticData: best.backtest.isSyntheticData,
    source: sourcedByPreset[best.strategyType]?.length ? 'backtest+sourced' : 'backtest',
    strategyId: best.id,
    generatedAt: Date.now(),
  };
}

async function runCycle(state) {
  const sourcedByPreset = await maybeRefreshSourcedCandidates(state);
  const signals = loadSignals();

  for (const token of TOKENS) {
    try {
      const entry = await runOneToken(token, state, sourcedByPreset);
      if (entry) signals[token] = entry;
    } catch (err) {
      log(`${token}: FAILED — ${err.message}`);
    }
  }

  saveState(state);
  saveSignals(signals);
  log(`cycle complete — wrote ${Object.keys(signals).length} signal(s) to ${SIGNALS_PATH}`);
}

(async () => {
  const state = loadState();

  if (RUN_ONCE) {
    await runCycle(state);
    return;
  }

  do {
    await runCycle(state);
    await sleep(INTERVAL_MS);
  } while (true);
})();
