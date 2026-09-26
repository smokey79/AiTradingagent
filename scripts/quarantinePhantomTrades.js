/**
 * scripts/quarantinePhantomTrades.js
 *
 * One-off correction, 2026-09-15. Two jobs:
 *   1. Move simulated flash-loan records OUT of trade_ledger.json into
 *      data/quarantine_simulated_trades.json so nothing learns from them.
 *   2. Reset the counters that were inflated by them.
 *
 * Why: an audit found trade_ledger.json carrying +$82.55 of flash-loan
 * "profit" (3 records, 100% win rate) while the portfolio's real P&L for the
 * same period was -$0.08. The P&L came from simulateFlashLoan(), never from
 * the portfolio. Left in place, the rolling win-rate gate would have learned
 * that flash-loan arbitrage never loses.
 *
 * Nothing is deleted. Everything moved is written to the quarantine file, and
 * the original ledger is backed up first.
 *
 * Run:  node scripts/quarantinePhantomTrades.js          (dry run — shows plan)
 *       node scripts/quarantinePhantomTrades.js --apply  (makes the changes)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const LEDGER = path.join(DATA, 'trade_ledger.json');
const QUARANTINE = path.join(DATA, 'quarantine_simulated_trades.json');
const PORTFOLIO = path.join(DATA, 'portfolio_state.json');
const APPLY = process.argv.includes('--apply');

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
    .filter(Boolean);
}

const rows = readJsonl(LEDGER);
const isPhantom = (t) => t.side === 'FLASHLOAN' || t.simulated === true || t.flashLoan === true;
const phantom = rows.filter(isPhantom);
const keep = rows.filter((t) => !isPhantom(t));

const phantomPnl = phantom.reduce((s, t) => s + (t.pnlUsd || 0), 0);
const keepPnl = keep.reduce((s, t) => s + (t.pnlUsd || 0), 0);

let port = {};
try { port = JSON.parse(fs.readFileSync(PORTFOLIO, 'utf8')); } catch (_) {}

console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n`);
console.log(`Ledger records total        : ${rows.length}`);
console.log(`  simulated / flash-loan    : ${phantom.length}  (booked P&L $${phantomPnl.toFixed(2)})`);
console.log(`  real directional trades   : ${keep.length}  (booked P&L $${keepPnl.toFixed(2)})`);
console.log(`Portfolio actual totalPnL   : $${(port.totalPnL != null ? port.totalPnL : 0).toFixed(2)}`);
console.log(`Gap explained by quarantine : $${(phantomPnl).toFixed(2)}`);

if (phantom.length) {
  console.log('\nRecords to quarantine:');
  phantom.forEach((t) => console.log(`  ${String(t.timestamp).slice(0, 19)}  ${String(t.symbol).padEnd(6)} $${String(t.pnlUsd).padStart(7)}  ${t.outcome}`));
}

if (!APPLY) {
  console.log('\nRe-run with --apply to make these changes.\n');
  process.exit(0);
}

// 1. Back up the original ledger
const backup = path.join(DATA, `trade_ledger_preQuarantine_${Date.now()}.json`);
fs.copyFileSync(LEDGER, backup);
console.log(`\nBacked up original ledger -> ${path.basename(backup)}`);

// 2. Append to quarantine (never overwrite an existing quarantine file)
const existingQ = readJsonl(QUARANTINE);
const qOut = existingQ.concat(phantom.map((t) => ({
  ...t,
  quarantinedAt: new Date().toISOString(),
  quarantineReason: 'Simulated flash-loan P&L never reached the portfolio; excluded from all learning and win-rate math.',
})));
fs.writeFileSync(QUARANTINE, qOut.map((t) => JSON.stringify(t)).join('\n') + '\n');
console.log(`Quarantined ${phantom.length} record(s) -> ${path.basename(QUARANTINE)} (file now holds ${qOut.length})`);

// 3. Rewrite the ledger with only real directional trades
fs.writeFileSync(LEDGER, keep.map((t) => JSON.stringify(t)).join('\n') + (keep.length ? '\n' : ''));
console.log(`Ledger rewritten with ${keep.length} real record(s)`);

// 4. Reset the session counters that the phantom wins inflated
if (port && Object.keys(port).length) {
  const before = { ...port };
  port.totalPnL = parseFloat(keepPnl.toFixed(2));
  port.sessionPeakBalance = port.currentBalance;
  port.countersResetAt = new Date().toISOString();
  port.countersResetReason = 'Phantom flash-loan P&L quarantined 2026-09-15; counters rebased on real directional trades only.';
  fs.writeFileSync(PORTFOLIO, JSON.stringify(port, null, 2));
  console.log(`\nCounters reset:`);
  console.log(`  totalPnL          ${before.totalPnL} -> ${port.totalPnL}`);
  console.log(`  sessionPeakBalance ${before.sessionPeakBalance} -> ${port.sessionPeakBalance}`);
  console.log(`  currentBalance     ${port.currentBalance} (unchanged — this was always the real number)`);
}

console.log('\nDone. Restart the bot for the code changes to take effect.\n');
