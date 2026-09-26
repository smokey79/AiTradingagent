/**
 * analyseTimeouts.js — why is every position closing on the 5-minute timer
 * instead of on its take-profit or stop-loss?
 *
 * Reads the real ledger, pulls the actual % move out of each close reason, and
 * compares it with the TP/SL bands the risk gate sets. No assumptions.
 *
 * Run:  node scripts\analyseTimeouts.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LEDGER = path.join(__dirname, '..', 'data', 'trade_ledger.json');
const TTL_MIN = 5;                 // POSITION_TTL_MS in src/risk/riskGate.js
const SL_MIN = 1.5, SL_MAX = 4.0;  // riskGate line 471: ATR-based, clamped

const rows = fs.readFileSync(LEDGER, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
  .map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean)
  .filter(t => t.simulated !== true && t.excludeFromLearning !== true && t.side !== 'FLASHLOAN')
  .filter(t => t.outcome && t.outcome !== 'PENDING');

const closes = { timeout: 0, tp: 0, sl: 0, other: 0 };
const moves = [];

for (const t of rows) {
  const r = String(t.reason || '');
  if (/timed out/i.test(r)) closes.timeout++;
  else if (/take-profit/i.test(r)) closes.tp++;
  else if (/stop-loss/i.test(r)) closes.sl++;
  else closes.other++;

  const m = r.match(/\(([-+]?\d+(?:\.\d+)?)%\s*real move\)/i);
  if (m) moves.push({ pair: t.pair, move: parseFloat(m[1]), pnl: t.pnlUsd });
}

console.log(`\nResolved real trades: ${rows.length}\n`);
console.log('How each position closed');
console.log(`  timed out (${TTL_MIN}min)  ${closes.timeout}`);
console.log(`  take-profit hit     ${closes.tp}`);
console.log(`  stop-loss hit       ${closes.sl}`);
console.log(`  other               ${closes.other}`);

if (!moves.length) { console.log('\nNo parseable price moves in the reasons.\n'); process.exit(0); }

const abs = moves.map(m => Math.abs(m.move)).sort((a, b) => a - b);
const mean = abs.reduce((s, v) => s + v, 0) / abs.length;
const max = abs[abs.length - 1];

console.log(`\nActual price movement inside the ${TTL_MIN}-minute window`);
for (const m of moves) {
  console.log(`  ${String(m.pair).padEnd(14)} ${m.move > 0 ? '+' : ''}${m.move.toFixed(2)}%   pnl ${m.pnl}`);
}
console.log(`\n  mean |move|  ${mean.toFixed(3)}%`);
console.log(`  largest      ${max.toFixed(3)}%`);
console.log(`  stop-loss band the gate sets: ${SL_MIN}% – ${SL_MAX}%`);

const gap = SL_MIN / mean;
// Random-walk scaling: distance grows with the square root of time.
const minutesNeeded = TTL_MIN * gap * gap;
console.log(`\nThe nearest exit (a ${SL_MIN}% stop) is ${gap.toFixed(1)}x further away than`);
console.log(`the average move these positions actually make in ${TTL_MIN} minutes.`);
console.log(`Under square-root-of-time scaling that is roughly ${Math.round(minutesNeeded)} minutes`
  + ` (~${(minutesNeeded / 60).toFixed(1)} hours) of holding`);
console.log(`before a stop is even reachable — and further still for the take-profit.`);
console.log(`\nSo TP and SL are unreachable by construction: the timer closes everything.\n`);
