/**
 * BTC/USDT Strategy Discovery Lab — 2026-09-13
 * ===============================================
 * One-off research run (NOT a live PM2 process). Generates mcprule-compliant
 * Pine v6 strategies from real research (see report.md for sources), backtests
 * each via TradingKit's quick_backtest engine (Bybit BTCUSDT, tv_jul26 parity
 * engine, forced 0.05% commission / 100% equity / margin 100 / pyramiding 1),
 * evaluates against Alan's qualification bar, and keeps a running leaderboard.
 *
 * Qualification bar (from the task):
 *   netProfitPct > 0, totalTrades >= 250, profitFactor > 1.12,
 *   maxDrawdownPct <= 20.
 *
 * Usage: node lab.js run <batchFile.js>   — runs all strategies in a batch file
 */
const fs = require('fs');
const path = require('path');
const tk = require('../../src/data/tradingKitFeed');

const LEADERBOARD_PATH = path.join(__dirname, 'leaderboard.json');
const SYMBOL = 'BTCUSDT';
const TIMEFRAME = '60'; // 1h — good balance of trade-count and signal quality
// Full available Bybit BTCUSDT history as of 2026-09-13 (confirmed via
// plan_backtest_window coverage.firstOpenMs) — using the whole ~6.5y history
// (COVID crash, 2020-21 bull, 2022 bear, 2023-25 recovery/chop) is a far
// more honest robustness test than a 30-day window, and comfortably clears
// the 250-trade minimum for anything but the most selective systems.
const FROM_TS = 1585134000000; // 2020-03-25
const TO_TS = Date.now();

function loadLeaderboard() {
  try { return JSON.parse(fs.readFileSync(LEADERBOARD_PATH, 'utf8')); } catch { return []; }
}
function saveLeaderboard(arr) {
  fs.writeFileSync(LEADERBOARD_PATH, JSON.stringify(arr, null, 2));
}

function evaluate(kpi) {
  const reasons = [];
  if (!(kpi.netProfitPct > 0)) reasons.push(`net profit ${kpi.netProfitPct?.toFixed(2)}% <= 0`);
  if (!(kpi.totalTrades >= 250)) reasons.push(`only ${kpi.totalTrades} trades (need >=250)`);
  if (!(kpi.profitFactor > 1.12)) reasons.push(`profit factor ${kpi.profitFactor?.toFixed(2)} <= 1.12`);
  if (!(kpi.maxDrawdownPct <= 20)) reasons.push(`max drawdown ${kpi.maxDrawdownPct?.toFixed(2)}% > 20%`);
  return { pass: reasons.length === 0, reasons };
}

async function runStrategy(def) {
  const t0 = Date.now();
  const symbol = def.symbol || SYMBOL;
  const timeframe = def.timeframe || TIMEFRAME;
  const fromTs = def.fromTs || FROM_TS;
  const toTs = def.toTs || TO_TS;
  const plan = await tk.planBacktestWindow(symbol, timeframe, fromTs, toTs);
  const applied = plan?.applied || {};
  const result = await tk.quickBacktest({
    pineSource: def.pineSource,
    symbol: applied.symbol || symbol,
    timeframe,
    from: applied.fromTs || fromTs,
    to: applied.toTs || toTs,
    name: def.id,
    notes: `btc_strategy_lab round ${def.round}: ${def.concept}`,
  });

  if (!result || result.error || !result.result) {
    return {
      id: def.id, round: def.round, concept: def.concept, hypothesis: def.hypothesis,
      status: 'ERROR',
      error: result?.error || result?.message || JSON.stringify(result).slice(0, 300),
      durationMs: Date.now() - t0,
    };
  }

  const kpi = result.result;
  const verdict = evaluate(kpi);
  return {
    id: def.id, round: def.round, concept: def.concept, hypothesis: def.hypothesis,
    symbol: applied.symbol || symbol, timeframe,
    status: verdict.pass ? 'PASS' : 'FAIL',
    failReasons: verdict.reasons,
    netProfitPct: kpi.netProfitPct, profitFactor: kpi.profitFactor,
    maxDrawdownPct: kpi.maxDrawdownPct, totalTrades: kpi.totalTrades,
    winRatePct: kpi.winRatePct, sharpeRatio: kpi.sharpeRatio, sortinoRatio: kpi.sortinoRatio,
    longTrades: kpi.longTrades, shortTrades: kpi.shortTrades,
    avgBarsInTrade: kpi.avgBarsInTrade, avgTradePct: kpi.avgTradePct,
    resultId: result.resultId, strategyId: result.strategyId, viewUrl: result.viewUrl,
    pineSource: def.pineSource,
    durationMs: Date.now() - t0,
  };
}

async function runBatch(batch) {
  const leaderboard = loadLeaderboard();
  for (const def of batch) {
    process.stdout.write(`[${def.id}] running... `);
    try {
      const entry = await runStrategy(def);
      leaderboard.push(entry);
      saveLeaderboard(leaderboard); // save after every single run — durable progress
      if (entry.status === 'PASS') {
        console.log(`PASS  net=${entry.netProfitPct.toFixed(1)}% PF=${entry.profitFactor.toFixed(2)} DD=${entry.maxDrawdownPct.toFixed(1)}% trades=${entry.totalTrades}`);
      } else if (entry.status === 'FAIL') {
        console.log(`fail  (${entry.failReasons.join('; ')}) [net=${entry.netProfitPct?.toFixed(1)}% PF=${entry.profitFactor?.toFixed(2)} trades=${entry.totalTrades}]`);
      } else {
        console.log(`ERROR ${entry.error}`);
      }
    } catch (err) {
      console.log(`THROWN ${err.message}`);
      leaderboard.push({ id: def.id, round: def.round, concept: def.concept, status: 'ERROR', error: err.message });
      saveLeaderboard(leaderboard);
    }
  }
}

module.exports = { runBatch, evaluate, SYMBOL, TIMEFRAME, FROM_TS, TO_TS };

if (require.main === module) {
  const batchPath = process.argv[2];
  if (!batchPath) { console.error('usage: node lab.js <batchFile.js>'); process.exit(1); }
  const batch = require(path.resolve(batchPath));
  runBatch(batch).then(() => {
    console.log('batch complete.');
    process.exit(0);
  });
}
