/**
 * scripts/resetPaperBalance.js — set the PAPER portfolio to a new starting
 * balance and confirm the environment is genuinely in paper mode first.
 *
 * Refuses to run if PAPER_TRADING is not true. Backs up before writing.
 *
 * Run:  node scripts/resetPaperBalance.js 500
 */
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const target = parseFloat(process.argv[2] || process.env.INITIAL_DEPOSIT || '500');
const DATA = path.join(__dirname, '..', 'data');
const P = path.join(DATA, 'portfolio_state.json');

const paper = String(process.env.PAPER_TRADING || '').toLowerCase() === 'true'
  && String(process.env.TRADING_MODE || '').toLowerCase() === 'paper';

console.log('\nPaper-mode guard:');
console.log(`  PAPER_TRADING = ${process.env.PAPER_TRADING}`);
console.log(`  PAPER_TRADE   = ${process.env.PAPER_TRADE}`);
console.log(`  TRADING_MODE  = ${process.env.TRADING_MODE}`);
console.log(`  LIVE_TRADING  = ${process.env.LIVE_TRADING}`);

if (!paper) {
  console.log('\n  ❌ REFUSING: this environment is not unambiguously in paper mode.');
  console.log('     Set PAPER_TRADING=true and TRADING_MODE=paper before resetting a balance.\n');
  process.exit(1);
}
console.log('  ✅ paper mode confirmed — simulated money only\n');

let before = {};
try { before = JSON.parse(fs.readFileSync(P, 'utf8')); } catch (_) {}

if (Object.keys(before).length) {
  const backup = path.join(DATA, `portfolio_state_backup_${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(before, null, 2));
  console.log(`Backed up existing state -> ${path.basename(backup)}`);
}

const next = {
  currentBalance: target,
  totalPnL: 0,
  sessionPeakBalance: target,
  updatedAt: new Date().toISOString(),
  resetAt: new Date().toISOString(),
  resetReason: `Paper balance set to $${target} on 2026-09-15 (was $${before.currentBalance ?? 'n/a'}). Simulated funds.`,
};
fs.writeFileSync(P, JSON.stringify(next, null, 2));

console.log(`\nPaper portfolio reset:`);
console.log(`  currentBalance      ${before.currentBalance ?? 'n/a'}  ->  ${target}`);
console.log(`  totalPnL            ${before.totalPnL ?? 'n/a'}  ->  0`);
console.log(`  sessionPeakBalance  ${before.sessionPeakBalance ?? 'n/a'}  ->  ${target}`);
console.log(`\nNote: INITIAL_DEPOSIT in .env is ${process.env.INITIAL_DEPOSIT} — riskGate sizes positions from that.`);
console.log('Restart the bot for both to take effect.\n');
