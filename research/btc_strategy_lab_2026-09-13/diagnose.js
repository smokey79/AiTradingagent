const tk = require('../../src/data/tradingKitFeed');
const lb = require('./leaderboard.json');

(async () => {
  console.log('credits:', JSON.stringify(await tk.getCredits()));
  const best = lb.find((e) => e.id === 'R1_EMA200_Pullback');
  const trades = await tk.mcpCall('get_trades', { jobId: best.resultId });
  const list = Array.isArray(trades) ? trades : trades?.trades || [];
  console.log('trade count:', list.length);
  console.log('first 3 trades:', JSON.stringify(list.slice(0, 3), null, 2));
  console.log('last 3 trades:', JSON.stringify(list.slice(-3), null, 2));
  // count consecutive losers
  let maxLossStreak = 0, cur = 0;
  for (const t of list) {
    const pnl = t.netPnl ?? t.pnl ?? t.profit;
    if (pnl < 0) { cur++; maxLossStreak = Math.max(maxLossStreak, cur); } else cur = 0;
  }
  console.log('max consecutive losing trades:', maxLossStreak);
  process.exit(0);
})();
