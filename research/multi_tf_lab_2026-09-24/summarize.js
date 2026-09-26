/** Builds SUMMARY.md from results.json: PF heatmaps per strategy, and the robust list. */
const fs = require('fs'); const path = require('path');
const { COINS, TF_ORDER, STRATS } = require('./batch');
const R = JSON.parse(fs.readFileSync(path.join(__dirname, 'results.json'), 'utf8')).filter(r => r.status === 'OK');
const get = (s, c, t) => R.find(r => r.strat === s && r.coin === c && r.tfLabel === t);
let md = `# Multi-timeframe lab summary\n\nGenerated ${new Date().toISOString()} from ${R.length} completed backtests.\n\n` +
  'Cell = full-history pctPF / out-of-sample (2024+) PF. **Bold** = passed every check. "-" = not run or error.\n\n';
const robust = [];
for (const s of STRATS) {
  md += `## ${s}\n\n| Coin | ${TF_ORDER.join(' | ')} |\n|---|${TF_ORDER.map(() => '---').join('|')}|\n`;
  let coinsOk = 0;
  for (const c of Object.keys(COINS)) {
    const cells = TF_ORDER.map(t => get(s, c, t));
    md += `| ${c} | ` + cells.map(x => !x ? '-' : (x.pass ? `**${x.pctPF}/${x.oosPF}**` : `${x.pctPF}/${x.oosPF}`)).join(' | ') + ' |\n';
    const adjacent = cells.some((x, i) => x?.pass && cells[i + 1]?.pass);
    if (adjacent) coinsOk++;
  }
  md += `\nCoins with 2+ adjacent passing timeframes: **${coinsOk}**\n\n`;
  if (coinsOk >= 3) robust.push(s);
}
md += `## Verdict\n\n` + (robust.length
  ? `Robust (3+ coins, each with 2+ adjacent timeframes): ${robust.join(', ')}. Candidates for PAPER trading only.\n`
  : 'No strategy is robust across coins and neighbouring timeframes. Any single passing cell is most likely luck; do not trade it live.\n');
fs.writeFileSync(path.join(__dirname, 'SUMMARY.md'), md);
console.log(md);
