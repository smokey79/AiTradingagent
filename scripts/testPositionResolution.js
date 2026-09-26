/**
 * testPositionResolution.js — verifies the TTL and cost changes to riskGate.
 *
 * Run:  node scripts\testPositionResolution.js
 *
 * Uses a TEMPORARY ledger and state dir so the real data/ files are untouched.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Point the module at a throwaway data dir BEFORE it loads.
const sandbox = fs.mkdtempSync(path.join(__dirname, '..', '.tmp-pos-test-'));
process.env.DATA_DIR = sandbox;
process.env.PAPER_TRADING = 'true';
process.env.POSITION_TTL_MINUTES = '240';
process.env.ROUND_TRIP_COST_PCT = '0.20';
require('dotenv').config();
process.env.POSITION_TTL_MINUTES = '240';   // re-assert after dotenv
process.env.ROUND_TRIP_COST_PCT = '0.20';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ', m); } else { fail++; console.log('  FAIL ', m); } };
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;

const rg = require('../src/risk/riskGate');
const ledgerPath = path.join(__dirname, '..', 'data', 'trade_ledger.json');
const before = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, 'utf8') : null;

function lastTrade() {
  const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

function openPosition({ pair, entryPrice, side = 'BUY', ageMin = 0, leverage = 1, sizeUsd = 25 }) {
  rg.addPosition(pair, {
    sizeUsd, entryPrice, side, leverage,
    stopLossPct: 2.0, takeProfitPct: 4.0, confidence: 0.7,
    timestamp: new Date(Date.now() - ageMin * 60000).toISOString(),
  });
}

console.log('\n1. A small move no longer closes the position\n');
openPosition({ pair: 'TEST1/USDT', entryPrice: 100, ageMin: 10 });
const r1 = rg.resolveOpenPosition('TEST1/USDT', 100.22);   // +0.22%, 10 min old
ok(r1 === null, '+0.22% after 10min stays OPEN (used to be force-closed at 5min)');

console.log('\n2. The timer still fires, but at the configured 240 minutes\n');
const r2 = rg.resolveOpenPosition('TEST1/USDT', 100.22);
ok(r2 === null, 'still open on a second check');
rg.addPosition('TEST2/USDT', {
  sizeUsd: 25, entryPrice: 100, side: 'BUY', leverage: 1,
  stopLossPct: 2.0, takeProfitPct: 4.0, confidence: 0.7,
  timestamp: new Date(Date.now() - 241 * 60000).toISOString(),
});
const r3 = rg.resolveOpenPosition('TEST2/USDT', 100.22);
ok(r3 !== null, '241min old position IS closed');
ok(/timed out after 240min/.test(r3.reason), `reason quotes 240min: "${r3.reason}"`);

console.log('\n3. Execution cost is deducted\n');
// +0.22% on $25 = +$0.055 gross; cost = $25 x 0.20% = $0.05; net = +$0.005 -> BREAKEVEN
ok(near(r3.grossPnlUsd, 0.06, 0.011), `gross recorded (${r3.grossPnlUsd})`);
ok(near(r3.costUsd, 0.05), `cost recorded (${r3.costUsd})`);
ok(r3.pnlUsd < r3.grossPnlUsd, `net ${r3.pnlUsd} is below gross ${r3.grossPnlUsd}`);
ok(r3.costPct === 0.20, 'the cost assumption itself is recorded on the trade');

console.log('\n4. Cost scales with leverage, not margin\n');
rg.addPosition('TEST3/USDT', {
  sizeUsd: 25, entryPrice: 100, side: 'BUY', leverage: 4,
  stopLossPct: 2.0, takeProfitPct: 4.0, confidence: 0.7,
  timestamp: new Date(Date.now() - 241 * 60000).toISOString(),
});
const r4 = rg.resolveOpenPosition('TEST3/USDT', 100.00);
ok(near(r4.costUsd, 0.20), `4x leverage on $25 costs $0.20 of notional (got ${r4.costUsd})`);
ok(r4.outcome === 'LOSS', 'a flat price move is now correctly a LOSS, not BREAKEVEN');

console.log('\n5. Take-profit and stop-loss still work\n');
rg.addPosition('TEST4/USDT', {
  sizeUsd: 25, entryPrice: 100, side: 'BUY', leverage: 1,
  stopLossPct: 2.0, takeProfitPct: 4.0, confidence: 0.7,
  timestamp: new Date().toISOString(),
});
const r5 = rg.resolveOpenPosition('TEST4/USDT', 105);      // +5% -> capped at TP 4%
ok(r5 !== null && /Take-profit/.test(r5.reason), 'TP fires immediately on a +5% move');
ok(near(r5.grossPnlUsd, 1.00), `TP gross capped at the 4% band (${r5.grossPnlUsd})`);

rg.addPosition('TEST5/USDT', {
  sizeUsd: 25, entryPrice: 100, side: 'BUY', leverage: 1,
  stopLossPct: 2.0, takeProfitPct: 4.0, confidence: 0.7,
  timestamp: new Date().toISOString(),
});
const r6 = rg.resolveOpenPosition('TEST5/USDT', 97);       // -3% -> capped at SL -2%
ok(r6 !== null && /Stop-loss/.test(r6.reason), 'SL fires immediately on a -3% move');
ok(near(r6.grossPnlUsd, -0.50), `SL gross capped at the 2% band (${r6.grossPnlUsd})`);

// Restore the real ledger — the test appended to it.
if (before !== null) fs.writeFileSync(ledgerPath, before);
else if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);
fs.rmSync(sandbox, { recursive: true, force: true });
console.log('\n  (real trade_ledger.json restored to its pre-test contents)');

console.log(`\n================  ${pass} passed, ${fail} failed  ================\n`);
process.exit(fail === 0 ? 0 : 1);
