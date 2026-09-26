/**
 * Realistic-position-sizing resimulation.
 *
 * WHY THIS EXISTS: TradingKit's quick_backtest engine hard-forces 100%-of-
 * equity position sizing on every trade (confirmed empirically — an explicit
 * `sizing` override is silently overwritten back to percent_of_equity:100,
 * logged as a "parity profile" adjustment). That's fine for comparing
 * TradingView-parity numbers, but it means the engine's own netProfit/
 * drawdown figures are a FULL-EQUITY-COMPOUNDING STRESS TEST, not a
 * realistic result: a losing streak wipes out a devastating fraction of
 * capital because every single trade re-risks the entire (shrinking)
 * account. Round 1 found every strategy at -60% to -99% drawdown this way,
 * even ones with a real (if modest) statistical edge.
 *
 * get_trades DOES return `profitPct` per trade — the trade's raw % return
 * on ITS OWN notional, independent of account size. That's exactly what's
 * needed to resimulate under realistic fixed-fractional position sizing:
 * "what if I only committed exposureFrac of my account to each trade
 * instead of 100%?" Equity then compounds as
 *   equity *= (1 + exposureFrac * profitPct_i / 100)   for each trade i,
 * which is the standard way retail/prop risk management actually sizes
 * positions (a fixed, modest fraction of equity per trade, not all-in).
 *
 * This also yields a cleaner, sizing-independent profit factor computed
 * directly from the % returns (sum of winning % / abs(sum of losing %)),
 * which is not distorted by compounding the way the engine's dollar-based
 * profit factor is.
 */
const tk = require('../../src/data/tradingKitFeed');

async function fetchTrades(resultId) {
  const r = await tk.mcpCall('get_trades', { jobId: resultId });
  return Array.isArray(r) ? r : (r?.trades || []);
}

function pctBasedProfitFactor(trades) {
  let grossWin = 0, grossLoss = 0;
  for (const t of trades) {
    const p = t.profitPct;
    if (p > 0) grossWin += p; else grossLoss += -p;
  }
  return grossLoss === 0 ? Infinity : grossWin / grossLoss;
}

function resimulate(trades, exposureFrac) {
  let equity = 1.0;
  let peak = 1.0;
  let maxDD = 0;
  for (const t of trades) {
    equity *= (1 + exposureFrac * (t.profitPct / 100));
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  return {
    netProfitPct: (equity - 1) * 100,
    maxDrawdownPct: maxDD,
    finalEquityMultiple: equity,
  };
}

async function analyzeRobustness(resultId, exposureFracs = [0.05, 0.10, 0.20]) {
  const trades = await fetchTrades(resultId);
  if (trades.length === 0) return null;
  const pctPF = pctBasedProfitFactor(trades);
  const maxLossStreak = (() => {
    let m = 0, c = 0;
    for (const t of trades) { if (t.profitPct < 0) { c++; m = Math.max(m, c); } else c = 0; }
    return m;
  })();
  const largestLossPct = Math.min(...trades.map((t) => t.profitPct));
  const largestWinPct = Math.max(...trades.map((t) => t.profitPct));
  const byExposure = {};
  for (const f of exposureFracs) byExposure[f] = resimulate(trades, f);
  return {
    tradeCount: trades.length,
    pctBasedProfitFactor: pctPF,
    maxConsecutiveLosses: maxLossStreak,
    largestSingleLossPct: largestLossPct,
    largestSingleWinPct: largestWinPct,
    byExposure,
  };
}

module.exports = { fetchTrades, pctBasedProfitFactor, resimulate, analyzeRobustness };
