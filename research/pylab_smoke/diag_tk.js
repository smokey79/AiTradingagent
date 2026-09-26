// Prints the first 16 TradingKit trades for the ETH 2h EMA_VWAP lab cell (uses 0 credits: get_trades on an existing result).
const tk = require('../../src/data/tradingKitFeed');
const r = require('../multi_tf_lab_2026-09-24/results.json').find(x => x.id === 'MTF_EMA_VWAP_ETH_2h');
(async () => {
  const t = await tk.mcpCall('get_trades', { jobId: r.resultId });
  const trades = Array.isArray(t) ? t : (t?.trades || []);
  console.log('TK trades', trades.length);
  for (const x of trades.slice(0, 16)) console.log(new Date(x.entryTime).toISOString(), x.direction, x.entryPrice.toFixed(2), '->', new Date(x.exitTime).toISOString(), x.exitPrice.toFixed(2), x.profitPct.toFixed(2), 'bars', x.barsInTrade);
  process.exit(0);
})();
