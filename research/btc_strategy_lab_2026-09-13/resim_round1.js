const fs = require('fs');
const { analyzeRobustness } = require('./resim');
const lb = require('./leaderboard.json');

(async () => {
  const out = [];
  for (const e of lb) {
    if (e.status === 'ERROR' || !e.resultId) continue;
    const r = await analyzeRobustness(e.resultId, [0.05, 0.10, 0.20]);
    out.push({ id: e.id, engineNetProfitPct: e.netProfitPct, engineProfitFactor: e.profitFactor, engineMaxDD: e.maxDrawdownPct, ...r });
    const at20 = r.byExposure[0.20];
    console.log(`${e.id.padEnd(28)} pctPF=${r.pctBasedProfitFactor.toFixed(2)}  maxLossStreak=${r.maxConsecutiveLosses}  @20%exposure: net=${at20.netProfitPct.toFixed(1)}% DD=${at20.maxDrawdownPct.toFixed(1)}%`);
  }
  fs.writeFileSync('resim_round1.json', JSON.stringify(out, null, 2));
})();
