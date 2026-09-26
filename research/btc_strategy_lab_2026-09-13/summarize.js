const lb = require('./leaderboard.json');
const rows = lb.filter((e) => e.status !== 'ERROR').map((e) => ({
  id: e.id, round: e.round, status: e.status,
  net: e.netProfitPct?.toFixed(1), pf: e.profitFactor?.toFixed(2),
  dd: e.maxDrawdownPct?.toFixed(1), trades: e.totalTrades,
  win: e.winRatePct?.toFixed(0), sharpe: e.sharpeRatio?.toFixed(2),
}));
rows.sort((a, b) => (b.pf || 0) - (a.pf || 0));
console.table(rows);
const errors = lb.filter((e) => e.status === 'ERROR');
if (errors.length) console.log('ERRORS:', errors.map((e) => `${e.id}: ${e.error}`).join('\n'));
