/**
 * traderDevAgent.js
 * =================
 * TraderDev Strategy Intelligence Agent
 *
 * Queries the public TraderDev strategy leaderboard (1M+ backtests, 240K+
 * strategies) for the current trading pair. Extracts the crowd's dominant
 * signal from top-ranked, backtested strategies and votes in consensus.
 *
 * Endpoints used (free, no API key):
 *   GET /strategies/search?symbol=BTCUSDT&sort=sharpe&minWinRatePct=55&minTrades=50&limit=5
 *
 * Signal logic:
 *   - If majority of top-5 strategies are profitable with strong Sharpe → BUY
 *   - If majority are losing or weak Sharpe → SELL bias
 *   - Otherwise → HOLD
 *
 * Results are cached for 5 minutes per symbol.
 */
const axios = require('axios');
const logger = require('../utils/logger');

// ── Config ───────────────────────────────────────────────────────────
const API_BASE = process.env.TRADERDEV_API_BASE || 'https://mcp-api.trader.dev';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const REQUEST_TIMEOUT_MS = 5000;
const TOP_N = 5;

// ── In-memory cache ──────────────────────────────────────────────────
const cache = new Map(); // symbol → { ts, data }

function getCached(symbol) {
  const entry = cache.get(symbol);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;
  return null;
}

function setCache(symbol, data) {
  cache.set(symbol, { ts: Date.now(), data });
}

// ── Symbol normalisation ─────────────────────────────────────────────
// Our system uses 'BTC', 'ETH' etc. TraderDev expects 'BTCUSDT'.
function normalizeSymbol(symbol) {
  if (!symbol) return 'BTCUSDT';
  const s = symbol.toUpperCase().replace(/[\/\-]/g, '');
  // Already has USDT suffix
  if (s.endsWith('USDT') || s.endsWith('USD') || s.endsWith('BUSD')) return s;
  return s + 'USDT';
}

// ── Fetch top strategies from TraderDev ──────────────────────────────
async function fetchTopStrategies(symbol) {
  const tdSymbol = normalizeSymbol(symbol);
  const url = `${API_BASE}/strategies/search`;
  const params = {
    symbol: tdSymbol,
    sort: 'sharpe',
    minWinRatePct: 55,
    minTrades: 50,
    limit: TOP_N,
  };

  const { data } = await axios.get(url, {
    params,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'AiTradingAgent/1.0',
    },
  });

  return data?.results || [];
}

// ── Synthesise crowd signal from strategy KPIs ───────────────────────
function synthesizeSignal(strategies, symbol) {
  if (!strategies || strategies.length === 0) {
    return {
      agent: 'traderdev_strategy',
      signal: 'HOLD',
      confidence: 0.50,
      reason: `TraderDev: no backtested strategies found for ${symbol}`,
      constraints: ['No crowd data available'],
      model_used: 'traderdev-leaderboard',
      provider: 'traderdev_strategy',
    };
  }

  // Extract KPIs from each strategy's latest result
  // ───────────────────────────────────────────────────────────────────────
  // DEDUPE — added 2026-09-15. A live probe of the API returned literal
  // duplicates inside a single top-5 response: BTCUSDT entries 3 and 4 were
  // both "Codex BTC 2h EMA5-VWAP ATR0.02 LS $100" with an identical Sharpe of
  // 15.79668212 and 216 trades; ETHUSDT entries 2 and 3 were near-identical
  // too. Without this, "5/5 strategies profitable" can be the same strategy
  // counted twice, which inflates the crowd signal with no new information.
  // ───────────────────────────────────────────────────────────────────────
  const seen = new Set();
  const deduped = strategies.filter((s) => {
    const k = s.result || s.latestResult || {};
    const fp = `${String(s.name || '').trim()}|${k.sharpeRatio ?? k.sharpe ?? ''}|${k.totalTrades ?? ''}`;
    if (seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });
  const duplicatesDropped = strategies.length - deduped.length;

  const kpis = deduped
    .map(s => s.result || s.latestResult)
    .filter(Boolean);

  if (kpis.length === 0) {
    return {
      agent: 'traderdev_strategy',
      signal: 'HOLD',
      confidence: 0.50,
      reason: `TraderDev: strategies found but no backtest results for ${symbol}`,
      constraints: ['Missing backtest data'],
      model_used: 'traderdev-leaderboard',
      provider: 'traderdev_strategy',
    };
  }

  // Calculate crowd metrics
  const profitableCount = kpis.filter(k => k.netProfitPct > 0).length;
  const sharpes = kpis.map(k => k.sharpeRatio || 0).sort((a, b) => a - b);
  const winRates = kpis.map(k => k.winRatePct || 0).sort((a, b) => a - b);
  const profitFactors = kpis.map(k => k.profitFactor || 0).sort((a, b) => a - b);
  const drawdowns = kpis.map(k => k.maxDrawdownPct || 0);

  const medianSharpe = sharpes[Math.floor(sharpes.length / 2)];
  const medianWR = winRates[Math.floor(winRates.length / 2)];
  const medianPF = profitFactors[Math.floor(profitFactors.length / 2)];
  const avgDD = drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length;
  const totalTrades = kpis.reduce((sum, k) => sum + (k.totalTrades || 0), 0);

  // Determine signal
  let signal = 'HOLD';
  let confidence = 0.65;
  let reason = '';

  const majorityProfitable = profitableCount >= Math.ceil(kpis.length * 0.6);

  // ───────────────────────────────────────────────────────────────────────
  // SELECTION-BIAS GUARD — added 2026-09-15 after a live probe.
  //
  // Two problems with the original rule, both confirmed against real data:
  //
  // 1. The query is `sort=sharpe&limit=5` against a pool the header describes
  //    as "240K+ strategies". Taking the five highest-Sharpe results from a
  //    quarter of a million backtests selects the extreme tail — the luckiest
  //    curve-fits, not the best strategies. Live values came back at Sharpe
  //    15.7-17.9 with 68-85% win rates. For scale, a sustained Sharpe above
  //    ~3 is exceptional and top quant funds run roughly 2-3. Numbers like
  //    these are an artefact of the selection, not evidence of edge.
  //
  // 2. Because medianSharpe is therefore ALWAYS far above the old 2.0
  //    threshold, the condition below could never fail — this agent emitted
  //    BUY on effectively every cycle, at up to 0.88 confidence. A permanent
  //    BUY vote is actively harmful in a market that spent 67% of the last
  //    year in a BEAR regime.
  //
  // Worth noting: "EMA3-VWAP ATR Trail" and "Codex BTC 2h EMA5-VWAP" on that
  // leaderboard are the same family as this project's own validated ETH
  // strategy, whose honest out-of-sample profit factor was 1.27. Same idea,
  // wildly different reported quality — which is the selection gap in one line.
  //
  // So: an implausible Sharpe now REDUCES confidence instead of raising it,
  // and a historical leaderboard no longer produces a directional BUY, because
  // "these backtests did well" carries no information about what price does
  // next. It reports as HOLD with the evidence attached, the same posture the
  // youtube-intel consensusEngine already takes toward creator agreement.
  // ───────────────────────────────────────────────────────────────────────
  const IMPLAUSIBLE_SHARPE = parseFloat(process.env.TRADERDEV_IMPLAUSIBLE_SHARPE || '4.0');
  const selectionBiasSuspected = medianSharpe > IMPLAUSIBLE_SHARPE;

  if (selectionBiasSuspected) {
    signal = 'HOLD';
    confidence = 0.50;
    reason = `TraderDev: median Sharpe ${medianSharpe.toFixed(1)} across the top ${kpis.length} exceeds the plausibility bar (${IMPLAUSIBLE_SHARPE}) — `
      + `this is the tail of a 240K-backtest leaderboard, so it is read as selection bias, not edge. No directional vote. `
      + `(${profitableCount}/${kpis.length} profitable, WR ${medianWR.toFixed(1)}%, ${totalTrades} trades`
      + (duplicatesDropped ? `, ${duplicatesDropped} duplicate entr${duplicatesDropped === 1 ? 'y' : 'ies'} dropped` : '') + ')';
  } else if (majorityProfitable && medianSharpe > 2.0 && medianWR > 58) {
    // Plausible range. Still not a directional call — a leaderboard describes
    // the past, not the next bar — so this reports quality without voting.
    signal = 'HOLD';
    confidence = 0.55;
    reason = `TraderDev crowd quality OK but non-directional: ${profitableCount}/${kpis.length} profitable, median Sharpe ${medianSharpe.toFixed(1)}, WR ${medianWR.toFixed(1)}%, PF ${medianPF.toFixed(1)}, ${totalTrades} trades. `
      + `Historical backtest quality says nothing about current direction, so no BUY/SELL is emitted.`;
  } else if (!majorityProfitable || medianSharpe < 0.5) {
    signal = 'SELL';
    confidence = Math.min(0.82, 0.65 + (0.5 - Math.max(0, medianSharpe)) * 0.1);
    reason = `TraderDev crowd SELL: only ${profitableCount}/${kpis.length} profitable, median Sharpe ${medianSharpe.toFixed(1)}, WR ${medianWR.toFixed(1)}%`;
  } else {
    signal = 'HOLD';
    confidence = 0.60;
    reason = `TraderDev crowd neutral: ${profitableCount}/${kpis.length} profitable, median Sharpe ${medianSharpe.toFixed(1)}, WR ${medianWR.toFixed(1)}% — inconclusive edge`;
  }

  return {
    agent: 'traderdev_strategy',
    signal,
    confidence: Math.max(0.50, Math.min(1.0, confidence)),
    reason,
    constraints: [
      `Avg max DD: ${avgDD.toFixed(1)}%`,
      `Median PF: ${medianPF.toFixed(2)}`,
      `Sample: ${strategies.length} strategies, ${totalTrades} trades`,
    ],
    model_used: 'traderdev-leaderboard',
    provider: 'traderdev_strategy',
    _meta: {
      strategiesAnalysed: strategies.length,
      medianSharpe,
      medianWinRate: medianWR,
      medianProfitFactor: medianPF,
      avgMaxDrawdown: avgDD,
      totalBacktestedTrades: totalTrades,
    },
  };
}

// ── Main getSignal interface ─────────────────────────────────────────
async function getSignal(symbol, marketData) {
  const tdSymbol = normalizeSymbol(symbol);

  // Check cache first
  const cached = getCached(tdSymbol);
  if (cached) {
    logger.debug(`[TraderDev] Cache hit for ${tdSymbol}`);
    return cached;
  }

  try {
    logger.info(`[TraderDev] Querying top-${TOP_N} strategies for ${tdSymbol} (sort=sharpe, minWR=55%, minTrades=50)...`);
    const strategies = await fetchTopStrategies(symbol);
    logger.info(`[TraderDev] Retrieved ${strategies.length} strategies for ${tdSymbol}`);

    const result = synthesizeSignal(strategies, tdSymbol);
    setCache(tdSymbol, result);

    logger.info(`[TraderDev] ${tdSymbol} → ${result.signal} (conf=${result.confidence.toFixed(2)}) — ${result.reason}`);
    return result;
  } catch (err) {
    logger.warn(`[TraderDev] API error for ${tdSymbol}: ${err.message}. Returning HOLD.`);
    return {
      agent: 'traderdev_strategy',
      signal: 'HOLD',
      confidence: 0.50,
      reason: `TraderDev unavailable: ${err.message}`,
      constraints: ['API error — fallback HOLD'],
      model_used: 'traderdev-leaderboard',
      provider: 'traderdev_strategy',
    };
  }
}

module.exports = {
  getSignal,
  getTraderDevSignal: getSignal,
  normalizeSymbol,
  fetchTopStrategies,
};
