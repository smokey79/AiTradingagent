/** Checks credits, which intervals TradingKit accepts, and the trade record fields. Runs NO backtests. */
const tk = require('../../src/data/tradingKitFeed');
const TF = ['15', '30', '60', '120', '240', '360', '720', 'D', '1D', '1440'];
(async () => {
  try { console.log('credits:', JSON.stringify(await tk.getCredits()).slice(0, 400)); } catch (e) { console.log('credits error', e.message); }
  for (const tf of TF) {
    try {
      const p = await tk.planBacktestWindow('BTCUSDT', tf, Date.UTC(2020, 2, 25), Date.now());
      console.log(`tf ${tf}:`, JSON.stringify(p?.applied || p).slice(0, 220));
    } catch (e) { console.log(`tf ${tf}: ERROR ${e.message}`); }
  }
  const fs = require('fs'), path = require('path');
  try {
    const lb = JSON.parse(fs.readFileSync(path.join(__dirname, '../btc_strategy_lab_2026-09-13/leaderboard.json'), 'utf8'));
    const one = lb.find(r => r.resultId);
    const r = await tk.mcpCall('get_trades', { jobId: one.resultId });
    const trades = Array.isArray(r) ? r : (r?.trades || []);
    console.log('trade fields:', trades[0] ? Object.keys(trades[0]).join(',') : 'none', '| sample:', JSON.stringify(trades[0]).slice(0, 300));
  } catch (e) { console.log('get_trades error', e.message); }
  process.exit(0);
})();
