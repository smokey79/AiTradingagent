/**
 * AiTradingAgent — TradingKit (trader.dev) MCP Client
 * =====================================================
 * Fixed 2026-09-13. The previous version of this file had TWO independent
 * bugs that meant it had NEVER once returned real data, from day one:
 *
 *  1. It called tool names (get_ticker, get_ohlcv, get_indicators,
 *     get_orderbook, get_signal, get_economic_calendar, get_market_overview,
 *     ping) that do not exist on the real TradingKit server. TradingKit is
 *     NOT a market-data feed — it's a Pine Script v6 backtesting-as-a-service
 *     + live Telegram/webhook alerts platform (quick_backtest,
 *     optimize_strategy, create_alert, etc.). Every call returned
 *     "MCP error -32602: Tool X not found".
 *  2. Even for a tool that DOES exist (e.g. whoami), every call skipped the
 *     required MCP session handshake (initialize -> notifications/initialized
 *     -> Mcp-Session-Id header on subsequent calls) and got back
 *     400 "Server not initialized" instead.
 *
 * Both errors were swallowed by the try/catch in the old mcpCall() and
 * silently returned null, so nothing ever surfaced. On top of that, the API
 * key baked in as a hard-coded fallback had been revoked.
 *
 * This version:
 *  - Does the real MCP session handshake once per process and reuses it.
 *  - Only calls tools that actually exist.
 *  - Repurposes the module around what TradingKit actually offers: it runs
 *    a compliant Pine v6 strategy through quick_backtest for each target
 *    token (on a schedule, via scripts/tradingkit_analyst.js — NOT inline
 *    in the fast debate loop, same "isolate the slow API call" pattern used
 *    for Hermes) and caches the result to data/tradingkit_signals.json.
 *    fetchSignal() below just reads that cache — fast, no live API call.
 *  - fetchCandles / fetchTicker / fetchIndicators / fetchOrderBook /
 *    fetchCalendarEvents / fetchMarketOverview now return null immediately
 *    and say why, rather than pretending to call something that doesn't
 *    exist. Real market data already comes from data/market_data.py
 *    (CCXT/Bitget + CoinGecko, built 2026-09-12) — TradingKit was never
 *    going to be a data source, only a backtesting/signal-confidence one.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs     = require('fs');
const path   = require('path');
const axios  = require('axios');
const logger = require('../utils/logger');

const TK_KEY     = process.env.TRADINGKIT_API_KEY || '';
const TK_BASE_URL = process.env.TRADINGKIT_MCP_URL
  || (TK_KEY ? `https://mcp.trader.dev/mcp?key=${TK_KEY}` : '');
// Fails closed if no key is configured — never falls back to a key in source.
const ENABLED    = process.env.TRADINGKIT_ENABLED !== 'false' && !!TK_KEY;

const SIGNAL_CACHE_PATH = path.resolve(__dirname, '../../data/tradingkit_signals.json');
const SIGNAL_MAX_AGE_MS = Number(process.env.TRADINGKIT_SIGNAL_MAX_AGE_MS || 6 * 60 * 60 * 1000); // 6h

if (!ENABLED) {
  logger.info('[TradingKit] disabled (no TRADINGKIT_API_KEY configured) — trading engine runs fine without it.');
}

// ── MCP session handling ───────────────────────────────────────────────────
// The Streamable HTTP transport requires a real handshake: initialize, then
// notifications/initialized, then reuse the returned Mcp-Session-Id on every
// subsequent call. One session is kept per process and reused for its life.
let _sessionId = null;
let _initPromise = null;

function _parseSSE(raw) {
  if (typeof raw !== 'string') return raw;
  const m = /data: (.*)/.exec(raw);
  return m ? JSON.parse(m[1]) : raw;
}

async function _rpc(method, params, id) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  if (_sessionId) headers['Mcp-Session-Id'] = _sessionId;
  const res = await axios.post(TK_BASE_URL, { jsonrpc: '2.0', id, method, params }, { headers, timeout: 20000 });
  if (res.headers['mcp-session-id']) _sessionId = res.headers['mcp-session-id'];
  return _parseSSE(res.data);
}

async function _ensureSession() {
  if (_sessionId) return;
  if (!_initPromise) {
    _initPromise = (async () => {
      await _rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'aitradingagent', version: '1.0' } }, 1);
      await _rpc('notifications/initialized', {}, undefined);
    })();
  }
  await _initPromise;
}

// FIXED 2026-09-23: mcpCall previously discarded the real error text on any
// failure (isError response OR a thrown/network error) and just returned
// null, so checkHealth() could only ever report a generic "no response" —
// which sent tradingkit_analyst.js into a 132-restart crash loop before the
// ACTUAL cause (a revoked API key) was ever visible anywhere. This
// module-level var carries the real message forward for checkHealth() to
// surface, without changing mcpCall's null-on-failure contract for its
// other callers.
let _lastToolError = null;

// Call a real TradingKit tool by name. Retries the handshake once if the
// session was lost server-side (e.g. after a long idle gap).
async function mcpCall(toolName, args = {}) {
  if (!ENABLED) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await _ensureSession();
      const r = await _rpc('tools/call', { name: toolName, arguments: args }, Date.now());
      const items = (r?.result?.content || []).filter((c) => c.type === 'text');
      if (r?.result?.isError) {
        _lastToolError = items.map((i) => i.text).join(' | ') || `${toolName} returned an error`;
        logger.debug(`[TradingKit] ${toolName} returned isError: ${_lastToolError}`);
        return null;
      }
      if (items.length === 0) return r?.result ?? null;
      // Some tools return a leading "USER HINT" text block followed by the
      // actual JSON payload (e.g. get_pine_codegen_rules, plan_backtest_window,
      // quick_backtest) — return the first item that parses as JSON, not just
      // the first item in the array.
      for (const item of items) {
        try { return JSON.parse(item.text); } catch { /* not this one */ }
      }
      return items[items.length - 1].text;
    } catch (err) {
      const status = err.response?.status;
      const isSessionError = status === 400 && /not initialized|session/i.test(JSON.stringify(err.response?.data || ''));
      if (isSessionError && attempt === 0) {
        _sessionId = null;
        _initPromise = null;
        continue; // retry once with a fresh handshake
      }
      _lastToolError = err.response?.data ? JSON.stringify(err.response.data).slice(0, 200) : err.message;
      logger.debug(`[TradingKit] ${toolName} failed: ${err.message}`);
      return null;
    }
  }
  return null;
}

// ── Real TradingKit tool wrappers (only tools that actually exist) ─────────

/** Confirm auth + return account info. Cheap — good as a health check. */
async function whoami() { return mcpCall('whoami', {}); }

/** Remaining credit balance (each quick_backtest costs 1 credit). */
async function getCredits() { return mcpCall('get_credits', {}); }

/** Resolve a fuzzy coin name/ticker to a tradeable Bybit USDT perp symbol. */
async function searchPerps(query, limit = 5) { return mcpCall('search_perps', { query, limit }); }

/** REQUIRED once before generating any Pine source for quick_backtest. */
let _pineRulesCache = null;
async function getPineCodegenRules() {
  if (_pineRulesCache) return _pineRulesCache;
  _pineRulesCache = await mcpCall('get_pine_codegen_rules', {});
  return _pineRulesCache;
}

/** Clamp/resolve a requested symbol+window against live data coverage. */
async function planBacktestWindow(symbol, timeframe, from, to) {
  return mcpCall('plan_backtest_window', { symbol, timeframe, from, to });
}

/** Run a Pine v6 strategy through the parity backtest engine. */
async function quickBacktest(opts) { return mcpCall('quick_backtest', opts); }

/** Create a live Telegram/webhook/email alert off an existing strategy. */
async function createAlert(opts) { return mcpCall('create_alert', opts); }

async function checkHealth() {
  const result = await whoami();
  if (!result || result.error) return { ok: false, error: result?.error || _lastToolError || 'no response' };
  return { ok: true, user: result.email || result.id, tier: result.tier };
}

// ── Signal cache (written by scripts/tradingkit_analyst.js) ────────────────
// The fast debate/consensus loop must never make a live TradingKit call
// (quick_backtest costs a credit and can take seconds) — it just reads this
// file, same pattern as the isolated hermes-analyst job.
function _readSignalCache() {
  try {
    return JSON.parse(fs.readFileSync(SIGNAL_CACHE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Get the most recent backtest-derived signal for a symbol, e.g. "BTC/USDT".
 * Returns null if TradingKit is disabled, has never run for this symbol, or
 * the cached result is older than TRADINGKIT_SIGNAL_MAX_AGE_MS (default 6h).
 */
async function fetchSignal(symbol /*, strategy */) {
  if (!ENABLED) return null;
  const cache = _readSignalCache();
  const base = symbol.replace(/[/-].*$/, '').toUpperCase(); // "BTC/USDT" -> "BTC"
  const entry = cache?.[base];
  if (!entry) return null;
  if (Date.now() - entry.generatedAt > SIGNAL_MAX_AGE_MS) return null;
  return entry;
}

// ── No-op stubs — TradingKit has no market-data tools, full stop ──────────
// Kept (rather than deleted) so src/dashboard/server.js doesn't need changes;
// they resolve to null immediately instead of making a doomed API call.
async function fetchCandles()        { return null; }
async function fetchTicker()         { return null; }
async function fetchIndicators()     { return null; }
async function fetchOrderBook()      { return null; }
async function fetchCalendarEvents() { return null; }
async function fetchMarketOverview() { return null; }

/**
 * Merge TradingKit's backtest-derived signal into an existing market-data
 * object. Falls back gracefully (returns baseMarketData unchanged) if
 * TradingKit is disabled or has no fresh signal for this pair.
 */
async function enrichMarketData(pair, baseMarketData = {}) {
  if (!ENABLED) return baseMarketData;
  try {
    const tkSignal = await fetchSignal(pair);
    if (!tkSignal) return baseMarketData;
    return {
      ...baseMarketData,
      tradingKitSignal: {
        action:         tkSignal.action,
        confidence:     tkSignal.confidence,
        reason:         tkSignal.reason,
        strategy:       tkSignal.strategy,
        netProfitPct:   tkSignal.netProfitPct,
        winRatePct:     tkSignal.winRatePct,
        sharpeRatio:    tkSignal.sharpeRatio,
        backtestWindow: tkSignal.window,
        generatedAt:    tkSignal.generatedAt,
        source:         'tradingkit',
      },
    };
  } catch (err) {
    logger.debug(`[TradingKit] enrichMarketData failed for ${pair}: ${err.message}`);
    return baseMarketData;
  }
}

module.exports = {
  // legacy-compatible surface (used by dashboard/server.js, consensus.js, orchestrator/index.js)
  fetchCandles,
  fetchTicker,
  fetchIndicators,
  fetchOrderBook,
  fetchSignal,
  fetchCalendarEvents,
  fetchMarketOverview,
  enrichMarketData,
  checkHealth,
  // real TradingKit tools — used by scripts/tradingkit_analyst.js
  mcpCall,
  whoami,
  getCredits,
  searchPerps,
  getPineCodegenRules,
  planBacktestWindow,
  quickBacktest,
  createAlert,
  SIGNAL_CACHE_PATH,
  TK_KEY,
  ENABLED,
};
