/**
 * src/utils/realism.js  (2026-10-03 calibration)
 *
 * One place for: trading costs, exchange minimum order size, the market-data quality gate,
 * the strategy promotion bar and the flash-loan observation lock.
 * Values come from config/realism.json; selected values can be overridden with environment
 * variables (see that file). Pure functions, no network calls, safe to require anywhere.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const CFG_PATH = path.join(ROOT, 'config', 'realism.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  } catch (e) {
    // Fail loud-but-safe: conservative built-in defaults identical to realism.json.
    return {
      costs: { fee_pct_per_side: 0.06, slippage_pct_per_side: 0.02 },
      min_order: { exchange: 'bitget', cache_file: 'data/exchange_limits.json', max_age_hours: 24, safety_buffer_pct: 5 },
      data_quality: { min_candles: 50, max_candle_age_multiple: 2.5, rsi_pegged_low: 1, rsi_pegged_high: 99,
        atr_min_pct_of_price: 0.0001, min_distinct_closes_last20: 3, max_ticker_vs_candle_deviation_pct: 5, allow_synthetic_candles: false },
      promotion: { min_oos_trades: 60, min_profit_factor: 1.3, min_oos_profit_factor: 1.3, max_drawdown_pct: 20,
        live_gate_win_rate: 0.68, live_gate_min_trades: 250, require_fees_included: true },
      arbitrage: { mode: 'observe', fork_test_marker: 'flashloan-sim/results/fork_test_passed.json' },
    };
  }
}

const CFG = loadConfig();
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? n : d; };

// ------------------------------------------------------------------ costs
function feePctPerSide() { return num(process.env.REALISM_FEE_PCT, CFG.costs.fee_pct_per_side); }
function slippagePctPerSide() { return num(process.env.REALISM_SLIPPAGE_PCT, CFG.costs.slippage_pct_per_side); }
/** Fraction (not percent) charged per side: 0.0008 for the default 0.06% + 0.02%. */
function costFractionPerSide() { return (feePctPerSide() + slippagePctPerSide()) / 100; }
/** Round-trip cost as a percent of notional (entry + exit). */
function roundTripCostPct() { return 2 * (feePctPerSide() + slippagePctPerSide()); }

// ------------------------------------------------------------------ exchange minimum order
let _limitsCache = { at: 0, data: null };
function limitsPath() { return process.env.EXCHANGE_LIMITS_PATH || path.join(ROOT, CFG.min_order.cache_file); }

function loadExchangeLimits() {
  const now = Date.now();
  if (_limitsCache.data && _limitsCache.path === limitsPath() && now - _limitsCache.at < 60000) return _limitsCache.data;
  let data = null;
  try { data = JSON.parse(fs.readFileSync(limitsPath(), 'utf8')); } catch (_) { data = null; }
  _limitsCache = { at: now, data, path: limitsPath() };
  return data;
}

function normalisePair(pair) {
  const p = String(pair || '').toUpperCase();
  return p.includes('/') ? p : `${p}/USDT`;
}

/**
 * Minimum order value in USD for a pair, from the exchange's own market info.
 * Returns { minUsd, source, ageHours } where minUsd is null when unknown (caller decides how to react).
 */
function minOrderUsd(pair, price) {
  const lim = loadExchangeLimits();
  if (!lim || !lim.markets) return { minUsd: null, source: 'no-exchange-limits-cache', ageHours: null };
  const m = lim.markets[normalisePair(pair)];
  const ageHours = lim.fetchedAt ? (Date.now() - Date.parse(lim.fetchedAt)) / 3.6e6 : null;
  if (!m) return { minUsd: null, source: `pair-not-listed-on-${lim.exchange}`, ageHours };
  const px = Number(price) > 0 ? Number(price) : Number(m.lastPrice) || 0;
  const byAmount = m.minAmount && px ? m.minAmount * px : 0;
  const raw = Math.max(m.minCostUsd || 0, byAmount);
  const buffered = raw * (1 + (CFG.min_order.safety_buffer_pct || 0) / 100);
  return { minUsd: +buffered.toFixed(4), source: `${lim.exchange}-market-info`, ageHours: ageHours == null ? null : +ageHours.toFixed(1),
    stale: ageHours != null && ageHours > CFG.min_order.max_age_hours };
}

// ------------------------------------------------------------------ data-quality gate
/**
 * Fail-closed check of the market snapshot an agent is about to vote on.
 * input: { candles: [[ts,o,h,l,c,v]|{timestamp,open,high,low,close,volume}], timeframeMs, nowMs,
 *          indicators:{rsi14,atr14}, price, tickerLast, sources:{candles,ticker} }
 * returns { ok, reasons: string[], metrics }
 */
function dataQualityCheck(input) {
  const q = CFG.data_quality;
  const reasons = [];
  const metrics = {};
  const candles = Array.isArray(input.candles) ? input.candles : [];
  const get = (c, i, k) => (Array.isArray(c) ? c[i] : c[k]);
  const src = input.sources || {};

  if (src.candles === 'synthetic' || src.candles === 'none') reasons.push(`candles are ${src.candles === 'none' ? 'missing' : 'synthetic'}`);
  if (src.ticker === 'seed') reasons.push('price is a hard-coded seed value, not a live quote');

  metrics.candles = candles.length;
  if (candles.length < q.min_candles) reasons.push(`only ${candles.length} candles (need ${q.min_candles})`);

  if (candles.length) {
    const last = candles[candles.length - 1];
    const lastTs = Number(get(last, 0, 'timestamp'));
    const tf = Number(input.timeframeMs) || 3600000;
    const now = Number(input.nowMs) || Date.now();
    if (Number.isFinite(lastTs)) {
      const ageMs = now - lastTs;
      metrics.lastCandleAgeMin = +(ageMs / 60000).toFixed(1);
      if (ageMs > q.max_candle_age_multiple * tf) reasons.push(`stale candles (last one opened ${metrics.lastCandleAgeMin} min ago)`);
    }
    const closes = candles.map((c) => Number(get(c, 4, 'close')));
    const vols = candles.slice(-10).map((c) => Number(get(c, 5, 'volume')));
    const distinct = new Set(closes.slice(-20).map((x) => +x.toFixed(10))).size;
    metrics.distinctClosesLast20 = distinct;
    if (distinct < q.min_distinct_closes_last20) reasons.push(`flat price series (${distinct} distinct closes in last 20)`);
    if (vols.length && vols.every((v) => !(v > 0))) reasons.push('zero volume on the last 10 candles');
    if (closes.some((x) => !(x > 0))) reasons.push('non-positive close price in series');
  }

  const ind = input.indicators || {};
  if (ind.rsi14 != null) {
    metrics.rsi14 = ind.rsi14;
    if (ind.rsi14 <= q.rsi_pegged_low || ind.rsi14 >= q.rsi_pegged_high) reasons.push(`RSI pegged at ${ind.rsi14}`);
  }
  const price = Number(input.price) || (candles.length ? Number(get(candles[candles.length - 1], 4, 'close')) : 0);
  if (ind.atr14 != null) {
    metrics.atr14 = ind.atr14;
    if (!(ind.atr14 > 0) || (price > 0 && ind.atr14 / price < q.atr_min_pct_of_price)) reasons.push(`ATR is zero/degenerate (${ind.atr14})`);
  }
  const tickerLast = Number(input.tickerLast);
  if (tickerLast > 0 && candles.length) {
    const lastClose = Number(get(candles[candles.length - 1], 4, 'close'));
    const dev = Math.abs(tickerLast - lastClose) / lastClose * 100;
    metrics.tickerVsCandleDevPct = +dev.toFixed(2);
    if (dev > q.max_ticker_vs_candle_deviation_pct) reasons.push(`ticker and candles disagree by ${dev.toFixed(1)}%`);
  }
  return { ok: reasons.length === 0, reasons, metrics };
}

function allowSyntheticCandles() {
  return String(process.env.ALLOW_SYNTHETIC_CANDLES || '').toLowerCase() === 'true' || CFG.data_quality.allow_synthetic_candles === true;
}

// ------------------------------------------------------------------ promotion bar
function promotionBar() {
  const p = CFG.promotion;
  return {
    minOosTrades: num(process.env.REALISM_MIN_OOS_TRADES, p.min_oos_trades),
    minProfitFactor: num(process.env.REALISM_MIN_PF, p.min_profit_factor),
    minOosProfitFactor: num(process.env.REALISM_MIN_OOS_PF, p.min_oos_profit_factor),
    maxDrawdownPct: num(process.env.REALISM_MAX_DD_PCT, p.max_drawdown_pct),
    liveGateWinRate: num(process.env.LIVE_GATE_WIN_RATE, p.live_gate_win_rate),
    liveGateMinTrades: num(process.env.LIVE_GATE_MIN_TRADES, p.live_gate_min_trades),
    requireFeesIncluded: p.require_fees_included !== false,
  };
}

/** Profit factor and max drawdown (percent of starting equity) from a chronological list of pnl in USD. */
function pnlStats(pnls, startEquity = 1000) {
  let gw = 0, gl = 0, eq = startEquity, peak = startEquity, maxDd = 0;
  for (const p of pnls) {
    if (p > 0) gw += p; else if (p < 0) gl += -p;
    eq += p; if (eq > peak) peak = eq;
    const dd = peak > 0 ? (peak - eq) / peak * 100 : 0; if (dd > maxDd) maxDd = dd;
  }
  const pf = gl === 0 ? (gw > 0 ? 99 : 0) : gw / gl;
  return { profitFactor: +pf.toFixed(3), maxDrawdownPct: +maxDd.toFixed(2), grossWin: +gw.toFixed(2), grossLoss: +gl.toFixed(2) };
}

/**
 * stats: { oosTrades, profitFactor, oosProfitFactor, maxDrawdownPct, feesIncluded }
 * returns { passed, reasons[] } -- unknown values fail (fail closed).
 */
function promotionCheck(stats) {
  const b = promotionBar();
  const r = [];
  if (!(stats.oosTrades >= b.minOosTrades)) r.push(`out-of-sample trades ${stats.oosTrades ?? 'unknown'} < ${b.minOosTrades}`);
  if (!(stats.profitFactor > b.minProfitFactor)) r.push(`profit factor ${stats.profitFactor ?? 'unknown'} not above ${b.minProfitFactor}`);
  if (stats.oosProfitFactor != null && !(stats.oosProfitFactor > b.minOosProfitFactor)) r.push(`OOS profit factor ${stats.oosProfitFactor} not above ${b.minOosProfitFactor}`);
  if (!(stats.maxDrawdownPct < b.maxDrawdownPct)) r.push(`drawdown ${stats.maxDrawdownPct ?? 'unknown'}% not under ${b.maxDrawdownPct}%`);
  if (b.requireFeesIncluded && stats.feesIncluded !== true) r.push('fees/slippage not confirmed as included');
  return { passed: r.length === 0, reasons: r };
}

// ------------------------------------------------------------------ flash-loan observation lock
function arbitrageMode() { return String(process.env.ARB_MODE || CFG.arbitrage.mode || 'observe').toLowerCase(); }
function forkTestPassed() {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, CFG.arbitrage.fork_test_marker), 'utf8'));
    return m && m.passed === true;
  } catch (_) { return false; }
}
/** Live flash-loan execution is allowed only when ARB_MODE=live AND the fork-test marker says passed. */
function liveArbAllowed() { return arbitrageMode() === 'live' && forkTestPassed(); }

module.exports = {
  feePctPerSide, slippagePctPerSide, costFractionPerSide, roundTripCostPct,
  minOrderUsd, loadExchangeLimits,
  dataQualityCheck, allowSyntheticCandles,
  promotionBar, pnlStats, promotionCheck,
  arbitrageMode, forkTestPassed, liveArbAllowed,
  CONFIG: CFG,
};
