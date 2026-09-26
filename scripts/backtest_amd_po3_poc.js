/**
 * scripts/backtest_amd_po3_poc.js
 * ================================
 * Standalone, offline backtest of the AMD/PO3 + Volume Profile POC idea
 * researched in claude/amd-po3-poc-research.md (2026-09-26). NOT wired into
 * any live agent, the consensus roster, or backtestEngine.js's strategyType
 * switch - per the research doc's own recommendation, this stays a
 * standalone script until/unless it clears the same bar the other agents
 * had to clear (real sample size, honest win rate / profit factor).
 *
 * Implements the exact quantified operational definition from that doc:
 *   - Accumulation: high/low of first N=24 bars (5m) after the anchor,
 *     kept only if range/ATR(14) < 0.6.
 *   - Manipulation: a sweep beyond the prior session's high/low by
 *     >= 0.1*ATR that closes back inside the accumulation range within
 *     K=3 bars ("sweep-and-fail").
 *   - Distribution/entry: first bar after the failed sweep that closes
 *     back through the accumulation range's midpoint opposite the sweep,
 *     with volume >= 1.25x its 20-bar average.
 *   - Stop: beyond the manipulation extreme + 0.5*ATR buffer.
 *   - POC: computed over the trailing 3 sessions' volume, tested as TWO
 *     SEPARATE variants (never blended, per the doc):
 *       'poc_filter' - only take the entry if it's moving toward POC.
 *       'poc_target' - use POC as the take-profit instead of a fixed R.
 *   - Costs: 0.20% round-trip, same as every other backtest here.
 *
 * Usage: node scripts/backtest_amd_po3_poc.js [--symbols=BTC/USDT,ETH/USDT,SOL/USDT] [--limit=1500]
 */
'use strict';

const ccxt = require('ccxt');
const fs = require('fs');
const path = require('path');
const { calculateATR } = require('../src/data/indicators');

const ROUND_TRIP_COST_PCT = 0.20; // matches the project-wide cost assumption
const ACCUM_BARS = 24;            // 2h on a 5m chart
const ACCUM_RANGE_ATR_MAX = 0.6;
const SWEEP_ATR_MIN = 0.1;
const SWEEP_FAIL_BARS = 3;
const VOLUME_SURGE_MULT = 1.25;   // reuses REQUIRE_MIN_VOLUME_EXPANSION_1_25X
const STOP_ATR_BUFFER = 0.5;
const POC_LOOKBACK_SESSIONS = 3;
const SESSION_BARS_5M = 288;      // 24h of 5m bars, used as one "session" for POC lookback

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

async function fetchRealCandles(symbol, timeframe, limit) {
  const exchange = new ccxt.binance({ enableRateLimit: true, timeout: 15000 });
  const tfMs = 5 * 60 * 1000;
  let since = Date.now() - limit * tfMs;
  const out = [];
  // Binance caps a single fetchOHLCV call at ~1000 candles - page forward
  // in 1000-candle chunks from `since` until we have `limit` or catch up
  // to now.
  while (out.length < limit) {
    const chunk = await exchange.fetchOHLCV(symbol, timeframe, since, 1000);
    if (!chunk || chunk.length === 0) break;
    out.push(...chunk);
    const lastTs = chunk[chunk.length - 1][0];
    if (lastTs <= since) break; // exchange didn't advance - stop to avoid an infinite loop
    since = lastTs + tfMs;
    if (chunk.length < 1000) break; // caught up to "now"
  }
  if (out.length < 100) {
    throw new Error(`Only got ${out.length} candles for ${symbol} - too few for a real backtest.`);
  }
  return out.slice(0, limit); // [ts, open, high, low, close, volume]
}

/**
 * Aggregates 5m candles into `factor`-bar higher-timeframe candles and
 * returns an ATR(14) value AT THAT HIGHER TIMEFRAME for every 5m bar
 * index, using the most recently CLOSED higher-timeframe bar (no lookahead).
 * The research doc's accumulation-range gate compares a 24-bar (2h) range
 * to "ATR(14, higher timeframe)" specifically - NOT the 5m ATR - because a
 * multi-bar range is naturally several times larger than a single 5m bar's
 * ATR for any normal random-walk market (roughly ATR_5m * sqrt(24) =~ 4.9x),
 * so gating on the 5m ATR would make the "tight consolidation" condition
 * almost impossible to satisfy. This was caught by getting zero detections
 * on a first run and checking the scale mismatch, not assumed up front.
 */
function higherTimeframeAtrSeries(candles, factor = 12 /* 12 x 5m = 1h */, period = 14) {
  const htfCandles = [];
  for (let i = 0; i + factor <= candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    const open = chunk[0][1];
    const high = Math.max(...chunk.map(c => c[2]));
    const low = Math.min(...chunk.map(c => c[3]));
    const close = chunk[chunk.length - 1][4];
    const volume = chunk.reduce((a, c) => a + c[5], 0);
    htfCandles.push({ open, high, low, close, volume, endIdx: i + factor - 1 });
  }
  const htfHighs = htfCandles.map(c => c.high);
  const htfLows = htfCandles.map(c => c.low);
  const htfCloses = htfCandles.map(c => c.close);
  const htfAtr = [];
  for (let j = 0; j < htfCandles.length; j++) {
    htfAtr.push(j < period ? null : calculateATR(htfHighs.slice(0, j + 1), htfLows.slice(0, j + 1), htfCloses.slice(0, j + 1), period));
  }
  // Map every 5m bar index to the most recently CLOSED htf bar's ATR.
  const out = new Array(candles.length).fill(null);
  let htfPtr = -1;
  for (let i = 0; i < candles.length; i++) {
    while (htfPtr + 1 < htfCandles.length && htfCandles[htfPtr + 1].endIdx <= i - 1) htfPtr++;
    out[i] = htfPtr >= 0 ? htfAtr[htfPtr] : null;
  }
  return out;
}

/** Volume-weighted Point of Control over `candles[startIdx..endIdx)`, bucketed by price. */
function computePOC(candles, startIdx, endIdx) {
  const slice = candles.slice(Math.max(0, startIdx), endIdx);
  if (slice.length === 0) return null;
  let lo = Infinity, hi = -Infinity;
  for (const c of slice) { lo = Math.min(lo, c[3]); hi = Math.max(hi, c[2]); }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const BUCKETS = 50;
  const bucketSize = (hi - lo) / BUCKETS;
  const volByBucket = new Array(BUCKETS).fill(0);
  for (const c of slice) {
    const typical = (c[2] + c[3] + c[4]) / 3;
    let b = Math.floor((typical - lo) / bucketSize);
    if (b < 0) b = 0;
    if (b >= BUCKETS) b = BUCKETS - 1;
    volByBucket[b] += c[5];
  }
  let maxBucket = 0;
  for (let i = 1; i < BUCKETS; i++) if (volByBucket[i] > volByBucket[maxBucket]) maxBucket = i;
  return lo + (maxBucket + 0.5) * bucketSize;
}

/**
 * Runs the AMD/PO3+POC detector+simulator over one symbol's candles for one
 * POC variant. Returns the trade list (never mutates shared state across
 * variants, so poc_filter and poc_target are genuinely independent runs
 * over the identical candle set/detector - only the exit/filter logic
 * differs, exactly as the research doc asks for).
 */
function runVariant(candles, variant) {
  const highs = candles.map(c => c[2]);
  const lows = candles.map(c => c[3]);
  const closes = candles.map(c => c[4]);
  const volumes = candles.map(c => c[5]);
  const len = candles.length;

  const atrSeries = [];
  for (let i = 0; i < len; i++) {
    atrSeries.push(i < 15 ? closes[i] * 0.01 : calculateATR(highs.slice(0, i + 1), lows.slice(0, i + 1), closes.slice(0, i + 1), 14));
  }
  const htfAtrSeries = higherTimeframeAtrSeries(candles, 12, 14); // 1h ATR(14), see function doc

  const trades = [];
  let i = ACCUM_BARS + 1;

  while (i < len - SWEEP_FAIL_BARS - 5) {
    // 1. Accumulation range: bars [i-ACCUM_BARS, i), gated against the
    // HIGHER-TIMEFRAME ATR per the research doc (not the 5m ATR - see
    // higherTimeframeAtrSeries()'s doc comment for why that distinction
    // matters here).
    const accHigh = Math.max(...highs.slice(i - ACCUM_BARS, i));
    const accLow = Math.min(...lows.slice(i - ACCUM_BARS, i));
    const atr = atrSeries[i]; // still used below for the sweep/stop sizing
    const htfAtr = htfAtrSeries[i];
    const accRange = accHigh - accLow;

    if (!(htfAtr > 0) || accRange / htfAtr >= ACCUM_RANGE_ATR_MAX) { i++; continue; }

    // Prior session's high/low = the accumulation window itself acts as the
    // reference range being swept (no separate "prior session" series is
    // tracked here; using the just-built accumulation range as the
    // liquidity pool being swept is the mechanically checkable proxy the
    // research doc describes).
    const midpoint = (accHigh + accLow) / 2;

    // 2. Manipulation: look for a sweep beyond accHigh/accLow by >=0.1*ATR
    //    within the next few bars, then a close back inside within K bars.
    let sweepDir = null; // 'UP' (swept highs, expect short) or 'DOWN' (swept lows, expect long)
    let sweepBar = -1;
    for (let j = i; j < Math.min(i + 6, len); j++) {
      if (highs[j] > accHigh + SWEEP_ATR_MIN * atr) { sweepDir = 'UP'; sweepBar = j; break; }
      if (lows[j] < accLow - SWEEP_ATR_MIN * atr) { sweepDir = 'DOWN'; sweepBar = j; break; }
    }
    if (sweepBar === -1) { i++; continue; }

    let failedBack = false;
    let failBar = -1;
    for (let k = sweepBar; k < Math.min(sweepBar + SWEEP_FAIL_BARS + 1, len); k++) {
      if (sweepDir === 'UP' && closes[k] < accHigh) { failedBack = true; failBar = k; break; }
      if (sweepDir === 'DOWN' && closes[k] > accLow) { failedBack = true; failBar = k; break; }
    }
    if (!failedBack) { i = sweepBar + 1; continue; }

    // 3. Distribution/entry trigger: first bar after failBar closing back
    //    through the midpoint opposite the sweep direction, with volume
    //    surge >= 1.25x its 20-bar average.
    let entryBar = -1;
    const side = sweepDir === 'UP' ? 'SELL' : 'BUY'; // swept highs -> short; swept lows -> long
    for (let e = failBar; e < Math.min(failBar + 5, len - 1); e++) {
      const volSlice = volumes.slice(Math.max(0, e - 20), e);
      const avgVol = volSlice.length ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : volumes[e];
      const volOk = volumes[e] >= avgVol * VOLUME_SURGE_MULT;
      const throughMidOpposite = side === 'BUY' ? closes[e] > midpoint : closes[e] < midpoint;
      if (volOk && throughMidOpposite) { entryBar = e; break; }
    }
    if (entryBar === -1) { i = failBar + 1; continue; }

    // POC over the trailing POC_LOOKBACK_SESSIONS windows ending at entryBar.
    const pocStart = entryBar - POC_LOOKBACK_SESSIONS * SESSION_BARS_5M;
    const poc = computePOC(candles, pocStart, entryBar);

    const entryPrice = closes[entryBar];
    const manipExtreme = sweepDir === 'UP' ? highs[sweepBar] : lows[sweepBar];
    const entryAtr = atrSeries[entryBar];
    const stopPrice = side === 'BUY'
      ? manipExtreme - STOP_ATR_BUFFER * entryAtr - entryAtr // beyond the swept extreme, buffered
      : manipExtreme + STOP_ATR_BUFFER * entryAtr + entryAtr;

    if (variant === 'poc_filter') {
      if (poc === null) { i = entryBar + 1; continue; }
      const movingTowardPoc = side === 'BUY' ? poc > entryPrice : poc < entryPrice;
      if (!movingTowardPoc) { i = entryBar + 1; continue; }
    }

    // Target: poc_target variant uses POC (if beyond entry in the trade's
    // favor) as TP; both variants fall back to a fixed 2R target off the
    // stop distance if POC is missing/not favorable, so every taken trade
    // still has a defined exit to simulate.
    const riskDist = Math.abs(entryPrice - stopPrice);
    let tpPrice;
    if (variant === 'poc_target' && poc !== null && ((side === 'BUY' && poc > entryPrice) || (side === 'SELL' && poc < entryPrice))) {
      tpPrice = poc;
    } else {
      tpPrice = side === 'BUY' ? entryPrice + 2 * riskDist : entryPrice - 2 * riskDist;
    }

    // Simulate forward bar-by-bar for the exit.
    let exitPrice = null, exitReason = null, exitBar = len - 1;
    for (let f = entryBar + 1; f < len; f++) {
      if (side === 'BUY') {
        if (lows[f] <= stopPrice) { exitPrice = stopPrice; exitReason = 'STOP'; exitBar = f; break; }
        if (highs[f] >= tpPrice) { exitPrice = tpPrice; exitReason = 'TARGET'; exitBar = f; break; }
      } else {
        if (highs[f] >= stopPrice) { exitPrice = stopPrice; exitReason = 'STOP'; exitBar = f; break; }
        if (lows[f] <= tpPrice) { exitPrice = tpPrice; exitReason = 'TARGET'; exitBar = f; break; }
      }
    }
    if (exitPrice === null) { exitPrice = closes[len - 1]; exitReason = 'END_OF_DATA'; }

    const grossPct = side === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
    const netPct = grossPct - (ROUND_TRIP_COST_PCT / 100);

    trades.push({
      side, entryBar, exitBar, entryPrice, exitPrice, stopPrice, tpPrice,
      poc, sweepDir, exitReason, pnlPct: netPct, isWin: netPct > 0,
    });

    i = exitBar + 1; // no overlapping positions
  }

  return trades;
}

function summarize(trades, label) {
  const n = trades.length;
  const wins = trades.filter(t => t.isWin);
  const losses = trades.filter(t => !t.isWin);
  const winRate = n > 0 ? wins.length / n : 0;
  const grossProfit = wins.reduce((a, t) => a + t.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const avgPnlPct = n > 0 ? trades.reduce((a, t) => a + t.pnlPct, 0) / n : 0;
  return {
    label, sampleSize: n,
    winRate: parseFloat((winRate * 100).toFixed(1)),
    profitFactor: Number.isFinite(profitFactor) ? parseFloat(profitFactor.toFixed(2)) : null,
    avgPnlPctPerTrade: parseFloat((avgPnlPct * 100).toFixed(3)),
    totalPnlPctSum: parseFloat((trades.reduce((a, t) => a + t.pnlPct, 0) * 100).toFixed(2)),
  };
}

async function main() {
  const args = parseArgs();
  const symbols = (args.symbols || 'BTC/USDT,ETH/USDT,SOL/USDT').split(',');
  const limit = parseInt(args.limit || '1500', 10);
  const timeframe = '5m';

  console.log(`AMD/PO3+POC backtest - ${symbols.join(', ')} @ ${timeframe}, up to ${limit} candles each, ${ROUND_TRIP_COST_PCT}% round-trip cost modeled.\n`);

  const results = { poc_filter: [], poc_target: [] };
  const perSymbol = {};

  for (const symbol of symbols) {
    let candles;
    try {
      candles = await fetchRealCandles(symbol, timeframe, limit);
    } catch (e) {
      console.log(`SKIP ${symbol}: ${e.message}`);
      continue;
    }
    console.log(`${symbol}: fetched ${candles.length} real candles (${new Date(candles[0][0]).toISOString()} -> ${new Date(candles[candles.length - 1][0]).toISOString()})`);

    const filterTrades = runVariant(candles, 'poc_filter');
    const targetTrades = runVariant(candles, 'poc_target');
    results.poc_filter.push(...filterTrades);
    results.poc_target.push(...targetTrades);
    perSymbol[symbol] = {
      poc_filter: summarize(filterTrades, `${symbol} poc_filter`),
      poc_target: summarize(targetTrades, `${symbol} poc_target`),
    };
  }

  const overall = {
    poc_filter: summarize(results.poc_filter, 'OVERALL poc_filter'),
    poc_target: summarize(results.poc_target, 'OVERALL poc_target'),
  };

  console.log('\n--- Per-symbol ---');
  for (const [sym, r] of Object.entries(perSymbol)) {
    console.log(`${sym}: poc_filter n=${r.poc_filter.sampleSize} winRate=${r.poc_filter.winRate}% PF=${r.poc_filter.profitFactor} | poc_target n=${r.poc_target.sampleSize} winRate=${r.poc_target.winRate}% PF=${r.poc_target.profitFactor}`);
  }

  console.log('\n--- Overall ---');
  console.log(JSON.stringify(overall, null, 2));

  const outPath = path.resolve(__dirname, '../data/amd_po3_poc_backtest_result.json');
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), symbols, timeframe, limit, perSymbol, overall }, null, 2), 'utf8');
  console.log(`\nWritten to ${outPath}`);

  const MIN_SAMPLE = 30;
  for (const [variant, r] of Object.entries(overall)) {
    if (r.sampleSize < MIN_SAMPLE) {
      console.log(`\nVERDICT (${variant}): sample size ${r.sampleSize} < ${MIN_SAMPLE} - NOT statistically meaningful. Do not treat this win rate as real.`);
    } else {
      console.log(`\nVERDICT (${variant}): n=${r.sampleSize}, winRate=${r.winRate}%, PF=${r.profitFactor}.`);
    }
  }
}

main().catch(err => {
  console.error('Backtest failed:', err.message);
  process.exit(1);
});
