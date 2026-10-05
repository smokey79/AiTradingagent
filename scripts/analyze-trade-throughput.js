const fs = require('fs');
const path = require('path');
const LEDGER = path.join(__dirname, '..', 'data', 'trade_ledger.json');

const lines = fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean);
const trades = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

console.log(`Total ledger entries: ${trades.length}`);

const byDay = {};
for (const t of trades) {
  if (!t.timestamp) continue;
  const day = t.timestamp.slice(0, 10);
  byDay[day] = byDay[day] || { total: 0, real: 0, flashloan: 0, wins: 0, losses: 0 };
  byDay[day].total++;
  if (t.side === 'FLASHLOAN') byDay[day].flashloan++;
  else byDay[day].real++;
  if (t.outcome === 'WIN') byDay[day].wins++;
  if (t.outcome === 'LOSS') byDay[day].losses++;
}

const days = Object.keys(byDay).sort();
console.log('\nDay        | Total | Real(non-flashloan) | Flashloan | Wins | Losses');
for (const d of days) {
  const s = byDay[d];
  console.log(`${d} | ${String(s.total).padStart(5)} | ${String(s.real).padStart(20)} | ${String(s.flashloan).padStart(9)} | ${String(s.wins).padStart(4)} | ${String(s.losses).padStart(6)}`);
}

const last7 = days.slice(-7);
const totalReal7 = last7.reduce((sum, d) => sum + byDay[d].real, 0);
console.log(`\nLast ${last7.length} day(s) with data -- avg real trades/day: ${(totalReal7 / last7.length).toFixed(1)}`);
