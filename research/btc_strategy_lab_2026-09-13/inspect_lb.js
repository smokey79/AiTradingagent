const lb = require('./leaderboard.json');
console.log('total entries:', lb.length);
console.log(JSON.stringify(Object.keys(lb[0]), null, 2));
for (const e of lb) {
  console.log(e.id, '|', e.round, '|', e.resultId, '|', e.profitFactor, '|', e.maxDrawdownPct, '|', e.totalTrades);
}
