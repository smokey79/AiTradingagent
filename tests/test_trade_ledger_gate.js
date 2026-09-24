/**
 * tests/test_trade_ledger_gate.js
 * Checks the live-funds gate in src/risk/tradeLedger.js (68% over the last 250 real trades,
 * no small-sample pass). Runs on a temporary copy, so data/trade_ledger.json is never touched.
 *
 * Run from F:\aitradingagent:   node tests/test_trade_ledger_gate.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgertest-'));
fs.mkdirSync(path.join(tmp, 'src', 'risk'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'src', 'utils'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'src', 'risk', 'tradeLedger.js'), path.join(tmp, 'src', 'risk', 'tradeLedger.js'));
fs.writeFileSync(path.join(tmp, 'src', 'utils', 'logger.js'), 'module.exports={info(){},warn(){},error(){},debug(){}};');
const LEDGER = path.join(tmp, 'data', 'trade_ledger.json');
const MOD = path.join(tmp, 'src', 'risk', 'tradeLedger.js');

function statsFor(rows, lastN = 20) {
  fs.writeFileSync(LEDGER, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  delete require.cache[require.resolve(MOD)];
  return require(MOD).getPerformanceStats(lastN);
}
const trades = (n, wins) => Array.from({ length: n }, (_, i) => ({ outcome: i < wins ? 'WIN' : 'LOSS', pnlUsd: i < wins ? 2 : -1, side: 'BUY' }));

let s = statsFor([]);
assert.strictEqual(s.winRate, 0, 'no trades: no invented 85% prior');
assert.strictEqual(s.profitabilityGatePassed, false, 'no trades: gate closed');

s = statsFor(trades(5, 5));
assert.strictEqual(s.profitabilityGatePassed, false, '5/5 wins must not pass (old loophole: under 10 trades passed)');

s = statsFor(trades(249, 249));
assert.strictEqual(s.profitabilityGatePassed, false, '249 trades is below the 250-trade minimum');

s = statsFor(trades(250, 169));
assert.strictEqual(s.profitabilityGatePassed, false, '67.6% over 250 is below 68%');

s = statsFor(trades(250, 170));
assert.strictEqual(s.profitabilityGatePassed, true, '68% over 250 passes, even when the caller asks for lastN=20');

s = statsFor([...trades(250, 170), { outcome: 'WIN', simulated: true, pnlUsd: 9 }, { outcome: 'WIN', side: 'FLASHLOAN' }]);
assert.strictEqual(s.liveGate.trades, 250, 'simulated and flash-loan records are ignored');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('tradeLedger live-gate tests passed (6 checks)');
