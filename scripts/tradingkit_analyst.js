/**
 * AiTradingAgent — TradingKit Analyst (periodic, isolated job)
 * ================================================================
 * Runs a fixed, mcprule-compliant Pine v6 EMA-cross strategy through
 * TradingKit's quick_backtest for each of the 7 target tokens on a slow
 * schedule (default every 4h), and writes the result to
 * data/tradingkit_signals.json for tradingKitFeed.fetchSignal() to read.
 *
 * Deliberately NOT called inline from the fast debate/consensus loop:
 * each quick_backtest costs 1 TradingKit credit (free tier: 1000/week) and
 * takes 1-3 seconds — same reasoning as scripts/hermes_analyst.py being its
 * own PM2 process instead of blocking the 120s debate cycle.
 *
 * This produces a "does a simple trend-following edge currently exist"
 * confidence signal from real historical performance — NOT a live price
 * tick. Per Alan's standing rule (see /preferences), it defaults to 'hold'
 * whenever the sample is small or the edge is negative, rather than ever
 * asserting a trade on thin evidence.
 *
 * Usage:
 *   node scripts/tradingkit_analyst.js         # loop forever (PM2 process)
 *   node scripts/tradingkit_analyst.js --once  # single cycle, then exit
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const tk   = require('../src/data/tradingKitFeed');

const DATA_DIR      = path.resolve(__dirname, '../data');
const SIGNALS_PATH  = tk.SIGNAL_CACHE_PATH;
const STATE_PATH    = path.join(DATA_DIR, 'tradingkit_state.json');
const INTERVAL_MS   = Number(process.env.TRADINGKIT_ANALYST_INTERVAL_S || 14400) * 1000; // 4h default
const WINDOW_DAYS   = Number(process.env.TRADINGKIT_BACKTEST_WINDOW_DAYS || 30);
const RUN_ONCE      = process.argv.includes('--once');

// Confirmed live via search_perps on 2026-09-13 — all 7 target tokens trade
// as Bybit USDT linear perps under their plain ticker.
const SYMBOL_MAP = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', CRO: 'CROUSDT', SOL: 'SOLUSDT',
  AVAX: 'AVAXUSDT', ARB: 'ARBUSDT', OP: 'OPUSDT',
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function log(msg) { console.log(`[${new Date().toISOString()}] [tradingkit-analyst] ${msg}`); }

// Fixed, mcprule-compliant strategy (checked against get_pine_codegen_rules
// on 2026-09-13 — allowlisted ta.* only, pyramiding=1, process_orders_on_close,
// ATR ratchet trail per the rule doc's "ALLOWED rewrite" pattern).
function buildPineSource() {
  return `//@version=6
strategy("AiTradingAgent EMA Cross", overlay=true, pyramiding=1,
  process_orders_on_close=true, commission_type=strategy.commission.percent,
  commission_value=0.05, initial_capital=10000,
  default_qty_type=strategy.percent_of_equity, default_qty_value=100,
  margin_long=100, margin_short=100)

fastLen = input.int(20, "Fast EMA")
slowLen = input.int(50, "Slow EMA")
rsiLen  = input.int(14, "RSI Length")
atrLen  = input.int(14, "ATR Length")
trailMultBase = input.float(2.0, "ATR Trail Mult")

fastEma = ta.ema(close, fastLen)
slowEma = ta.ema(close, slowLen)
rsiVal  = ta.rsi(close, rsiLen)
atrVal  = ta.atr(atrLen)

longEntry  = ta.crossover(fastEma, slowEma) and rsiVal < 70
shortEntry = ta.crossunder(fastEma, slowEma) and rsiVal > 30

var float longTrail = na
var float shortTrail = na

if longEntry
    strategy.entry("L", strategy.long)
    longTrail := close - atrVal * trailMultBase
if shortEntry
    strategy.entry("S", strategy.short)
    shortTrail := close + atrVal * trailMultBase

if strategy.position_size > 0
    newLong = close - atrVal * trailMultBase
    longTrail := na(longTrail) ? newLong : math.max(longTrail, newLong)
    strategy.exit("LX", from_entry="L", stop=longTrail)
if strategy.position_size < 0
    newShort = close + atrVal * trailMultBase
    shortTrail := na(shortTrail) ? newShort : math.min(shortTrail, newShort)
    strategy.exit("SX", from_entry="S", stop=shortTrail)

plot(fastEma, title="FastEMA")
plot(slowEma, title="SlowEMA")
`;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
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
  fs.renameSync(tmp, SIGNALS_PATH); // atomic swap — fetchSignal() never sees a half-written file
}

/**
 * Turn raw backtest KPIs into a conservative {action, confidence, reason}.
 * Defaults to 'hold' on a weak/negative edge or a thin sample — per Alan's
 * standing rule: never recommend trades with low odds or too few trades.
 */
function deriveSignal(kpi, windowLabel) {
  const { profitFactor, totalTrades, winRatePct, sharpeRatio, netProfitPct, longNetProfit, shortNetProfit } = kpi;
  const MIN_TRADES = 5;
  const hasEdge = profitFactor > 1 && totalTrades >= MIN_TRADES;
  let action = 'hold';
  if (hasEdge) action = longNetProfit >= shortNetProfit ? 'buy' : 'sell';

  const confidence = hasEdge
    ? Math.min(0.9, Math.max(0.2, profitFactor / 4))
    : 0.15;

  const reason = hasEdge
    ? `EMA20/50 trend-follow backtest (${windowLabel}): net ${netProfitPct.toFixed(1)}%, `
      + `win rate ${winRatePct.toFixed(0)}%, profit factor ${profitFactor.toFixed(2)}, `
      + `Sharpe ${sharpeRatio.toFixed(2)} over ${totalTrades} trades — leans ${action}.`
    : totalTrades < MIN_TRADES
      ? `Only ${totalTrades} backtested trades in the last ${windowLabel} — too few to trust, holding.`
      : `EMA20/50 trend-follow backtest (${windowLabel}) shows no edge (profit factor ${profitFactor.toFixed(2)}) — holding.`;

  return { action, confidence, reason };
}

async function runOneToken(token, state, pineSource) {
  const wireSymbol = SYMBOL_MAP[token];
  if (!wireSymbol) { log(`skip ${token}: no known Bybit perp symbol`); return null; }

  const from = Date.now() - WINDOW_DAYS * 86400000;
  const to = Date.now();
  const plan = await tk.planBacktestWindow(wireSymbol, '1h', from, to);
  const applied = plan?.applied || {};

  const existingId = state[token]?.strategyId;
  const result = await tk.quickBacktest({
    pineSource,
    symbol: applied.symbol || wireSymbol,
    timeframe: '1h',
    from: applied.fromTs || from,
    to: applied.toTs || to,
    ...(existingId
      ? { strategyId: existingId }
      : { name: `AiTradingAgent EMA Cross ${token}` }),
    notes: 'tradingkit-analyst periodic run',
  });

  if (!result?.result) {
    log(`${token}: quick_backtest returned no result (check credits/auth)`);
    return null;
  }
  if (result.strategyId) state[token] = { strategyId: result.strategyId };

  const kpi = result.result;
  const windowLabel = `${WINDOW_DAYS}d/1h`;
  const signal = deriveSignal(kpi, windowLabel);

  log(`${token}: ${signal.action} (conf ${signal.confidence.toFixed(2)}) — ${signal.reason}`);

  return {
    ...signal,
    strategy: 'tradingkit_ema_cross',
    netProfitPct: kpi.netProfitPct,
    winRatePct: kpi.winRatePct,
    sharpeRatio: kpi.sharpeRatio,
    profitFactor: kpi.profitFactor,
    totalTrades: kpi.totalTrades,
    window: windowLabel,
    resultId: result.resultId,
    strategyId: result.strategyId,
    viewUrl: result.viewUrl,
    generatedAt: Date.now(),
  };
}

async function runCycle() {
  const credits = await tk.getCredits();
  const balance = credits?.balance ?? null;
  log(`credit balance: ${balance ?? 'unknown'}`);
  const tokens = Object.keys(SYMBOL_MAP);
  if (balance !== null && balance < tokens.length) {
    log(`only ${balance} credits left — skipping this cycle to preserve the weekly grant.`);
    return;
  }

  const pineSource = buildPineSource();
  const state = loadState();
  const signals = loadSignals();

  for (const token of tokens) {
    try {
      const entry = await runOneToken(token, state, pineSource);
      if (entry) signals[token] = entry;
    } catch (err) {
      log(`${token}: FAILED — ${err.message}`);
    }
  }

  saveState(state);
  saveSignals(signals);
  log(`cycle complete — wrote ${Object.keys(signals).length} signals to ${SIGNALS_PATH}`);
}

(async () => {
  if (!tk.ENABLED) {
    log('TradingKit disabled (no TRADINGKIT_API_KEY) — exiting.');
    process.exit(0);
  }
  const health = await tk.checkHealth();
  if (!health.ok) {
    log(`auth check failed: ${health.error} — exiting.`);
    process.exit(1);
  }
  log(`authenticated as ${health.user} (tier: ${health.tier})`);

  do {
    await runCycle();
    if (!RUN_ONCE) await sleep(INTERVAL_MS);
  } while (!RUN_ONCE);
})();
