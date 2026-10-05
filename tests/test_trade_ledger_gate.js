/**
 * tests/test_trade_ledger_gate.js
 * Checks the live-funds gate in src/risk/tradeLedger.js:
 *   68% win rate over the last 250 real trades, no small-sample pass (2026-09-24), and since 2026-10-03 ALSO
 *   profit factor above 1.3, drawdown under 20% and fee-inclusive results (config/realism.json).
 * Runs on a temporary copy, so data/trade_ledger.json is never touched.
 *
 * Run from F:\aitradingagent:   node tests/test_trade_ledger_gate.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgertest-'));
for (const d of ['src/risk', 'src/utils', 'config', 'data']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'src/risk/tradeLedger.js'), path.join(tmp, 'src/risk/tradeLedger.js'));
fs.copyFileSync(path.join(ROOT, 'src/utils/realism.js'), path.join(tmp, 'src/utils/realism.js'));
fs.copyFileSync(path.join(ROOT, 'src/utils/ledgerDb.js'), path.join(tmp, 'src/utils/ledgerDb.js'));
fs.copyFileSync(path.join(ROOT, 'config/realism.json'), path.join(tmp, 'config/realism.json'));
fs.copyFileSync(path.join(ROOT, 'config/ledger_schema.sql'), path.join(tmp, 'config/ledger_schema.sql'));
fs.writeFileSync(path.join(tmp, 'src/utils/logger.js'), 'module.exports={info(){},warn(){},error(){},debug(){}};');
const LEDGER = path.join(tmp, 'data', 'trade_ledger.json');
const MOD = path.join(tmp, 'src', 'risk', 'tradeLedger.js');
process.env.INITIAL_DEPOSIT = '1000'; // drawdown percentages below are worked out on a $1000 account
delete process.env.LIVE_GATE_WIN_RATE; delete process.env.LIVE_GATE_MIN_TRADES;

function statsFor(rows, lastN = 20) {
  fs.writeFileSync(LEDGER, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  for (const k of Object.keys(require.cache)) if (k.startsWith(tmp)) delete require.cache[k];
  return require(MOD).getPerformanceStats(lastN);
}
// wins first, then losses. Real, fee-inclusive rows: costUsd recorded.
const trades = (n, wins, win = 2, loss = -1, cost = 0.01) => Array.from({ length: n }, (_, i) => ({
  outcome: i < wins ? 'WIN' : 'LOSS', pnlUsd: i < wins ? win : loss, side: 'BUY', costUsd: cost,
}));

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
assert.strictEqual(s.profitabilityGatePassed, true, '68% over 250 with PF 4.25, tiny drawdown, fees included passes, even when lastN=20');
assert.ok(s.liveGate.profitFactor > 1.3 && s.liveGate.maxDrawdownPct < 20 && s.liveGate.feesIncluded === true);

s = statsFor([...trades(250, 170), { outcome: 'WIN', simulated: true, pnlUsd: 9, costUsd: 0.01 }, { outcome: 'WIN', side: 'FLASHLOAN', costUsd: 0.01 },
  { outcome: 'WIN', isSimulated: true, pnlUsd: 9, costUsd: 0.01 }]);
assert.strictEqual(s.liveGate.trades, 250, 'simulated, isSimulated and flash-loan records are ignored');

// ---- 2026-10-03 additions
s = statsFor(trades(250, 170).map(({ costUsd, ...r }) => r));
assert.strictEqual(s.liveGate.feesIncluded, false);
assert.strictEqual(s.profitabilityGatePassed, false, '68% over 250 but results not fee-inclusive must NOT pass');

s = statsFor(trades(250, 170, 0.5, -2));
assert.ok(s.liveGate.winRate >= 0.68 && s.liveGate.profitFactor < 1.3);
assert.strictEqual(s.profitabilityGatePassed, false, '68% win rate with profit factor under 1.3 must NOT pass');

const ddRows = [...trades(30, 0, 0, -10), ...trades(170, 170, 4, -1), ...trades(50, 0, 0, -1)]; // 170 wins of 250 = 68%
s = statsFor(ddRows);
assert.ok(s.liveGate.winRate >= 0.68 && s.liveGate.profitFactor > 1.3, 'fixture should meet win rate and PF');
assert.ok(s.liveGate.maxDrawdownPct >= 20, `fixture drawdown should be >= 20%, got ${s.liveGate.maxDrawdownPct}`);
assert.strictEqual(s.profitabilityGatePassed, false, '68% and PF ok but drawdown >= 20% must NOT pass');

// ---- real-trade filter used by learning modules
for (const k of Object.keys(require.cache)) if (k.startsWith(tmp)) delete require.cache[k];
fs.writeFileSync(LEDGER, [
  { id: 'a', outcome: 'WIN', pnlUsd: 1, side: 'BUY', costUsd: 0.01 },                         // real
  { id: 'b', outcome: 'WIN', pnlUsd: 1, side: 'BUY' },                                        // no cost recorded: not fee-inclusive
  { id: 'c', outcome: 'WIN', pnlUsd: 1, side: 'FLASHLOAN', costUsd: 0.01 },                   // flash loan
  { id: 'd', outcome: 'WIN', pnlUsd: 1, side: 'BUY', costUsd: 0.01, isSimulated: true },      // simulated
  { id: 'e', outcome: 'PENDING', pnlUsd: 0, side: 'BUY', costUsd: 0.01 },                     // unresolved
].map(r => JSON.stringify(r)).join('\n') + '\n');
const real = require(MOD).loadRealTrades();
assert.deepStrictEqual(real.map(r => r.id), ['a'], 'loadRealTrades keeps only real, fee-inclusive, resolved trades');

// ---- recordTrade stamps provenance flags
fs.writeFileSync(LEDGER, '');
const e1 = require(MOD).recordTrade({ pair: 'BTC/USDT', side: 'BUY', pnlUsd: 1, outcome: 'WIN', costUsd: 0.02, paper: true });
assert.strictEqual(e1.source, 'dry_run'); assert.strictEqual(e1.feesIncluded, true); assert.strictEqual(e1.isSimulated, false);
const e2 = require(MOD).recordTrade({ pair: 'BTC/USDT', side: 'FLASHLOAN', pnlUsd: 80, outcome: 'WIN', paper: true });
assert.strictEqual(e2.isSimulated, true); assert.strictEqual(e2.feesIncluded, false);

try { require(path.join(tmp, 'src', 'utils', 'ledgerDb')).close(); } catch (_) { /* nothing open */ }
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (e) { console.log('note: temp folder left behind:', tmp); }
console.log('tradeLedger live-gate tests passed (14 checks)');
