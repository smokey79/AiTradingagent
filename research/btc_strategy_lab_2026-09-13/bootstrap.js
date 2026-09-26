/**
 * Monte Carlo bootstrap robustness check ("100x tests").
 *
 * A single backtest gives ONE specific ordering of trades. Real markets
 * could have delivered those same trades in a different order (or a
 * resample of similar trades), and max drawdown in particular is highly
 * sensitive to sequence -- a run of losses early vs. late in the sequence
 * produces very different drawdown numbers even with identical trades.
 *
 * This resamples each strategy's trade list WITH REPLACEMENT, N times
 * (same length as the original), resimulates equity under realistic
 * fixed-fractional sizing for each resample, and reports the distribution
 * (median / 5th-95th percentile) of net profit and max drawdown -- a much
 * more honest robustness statement than one fixed historical path.
 */
const { fetchTrades, resimulate } = require('./resim.js');

function percentile(sortedArr, p) {
  const idx = Math.floor(p * (sortedArr.length - 1));
  return sortedArr[idx];
}

async function bootstrapAnalyze(resultId, exposureFrac = 0.15, iterations = 100) {
  const trades = await fetchTrades(resultId);
  if (!trades || trades.length === 0) return null;
  const n = trades.length;
  const nets = [];
  const dds = [];
  for (let i = 0; i < iterations; i++) {
    const sample = [];
    for (let j = 0; j < n; j++) {
      sample.push(trades[Math.floor(Math.random() * n)]);
    }
    const r = resimulate(sample, exposureFrac);
    nets.push(r.netProfitPct);
    dds.push(r.maxDrawdownPct);
  }
  nets.sort((a, b) => a - b);
  dds.sort((a, b) => a - b);
  const pctPositive = nets.filter((x) => x > 0).length / iterations;
  return {
    tradeCount: n,
    iterations,
    exposureFrac,
    netProfitPct: { p5: percentile(nets, 0.05), median: percentile(nets, 0.5), p95: percentile(nets, 0.95) },
    maxDrawdownPct: { p5: percentile(dds, 0.05), median: percentile(dds, 0.5), p95: percentile(dds, 0.95) },
    pctIterationsProfitable: pctPositive,
  };
}

module.exports = { bootstrapAnalyze };
