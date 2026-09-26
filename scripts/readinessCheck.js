/**
 * scripts/readinessCheck.js — answers four questions with facts, not opinion:
 *   1. Is the TraderDev agent configured, and where do its numbers come from?
 *   2. What is the DeFi wallet currently set to, and can anything sign with it?
 *   3. Is Bitget configured, and what would funding it actually enable?
 *   4. Is there any validated evidence of an edge to deploy $500 against?
 *
 * Read-only. Never prints a key or a private value.
 * Run: node scripts/readinessCheck.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function envKeys(file, re) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => ({ key: l.slice(0, l.indexOf('=')).trim(), val: l.slice(l.indexOf('=') + 1).trim() }))
    .filter((k) => re.test(k.key));
}
const mask = (v) => (!v ? 'EMPTY' : `SET (len ${v.length}, ...${v.slice(-4)})`);

console.log('\n============ 1. TRADERDEV ============\n');
const tdFiles = [];
(function walk(d, depth) {
  if (depth > 3) return;
  let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
  for (const x of e) {
    if (x.name === 'node_modules' || x.name === '_archive' || x.name === 'venv') continue;
    const f = path.join(d, x.name);
    if (x.isDirectory()) walk(f, depth + 1);
    else if (/traderdev|trader_dev/i.test(x.name)) tdFiles.push(f);
  }
})(path.join(ROOT, 'src'), 0);
console.log(tdFiles.length ? '  Files:' : '  No traderdev source files found under src/');
tdFiles.forEach((f) => console.log(`    ${f.replace(ROOT, '.')}  (${fs.statSync(f).size} bytes)`));

const tdEnv = envKeys('.env', /TRADERDEV|TRADER_DEV/i).concat(envKeys('config/.env', /TRADERDEV|TRADER_DEV/i));
console.log(`\n  Env keys: ${tdEnv.length ? tdEnv.map((k) => `${k.key}=${mask(k.val)}`).join(', ') : 'none'}`);

console.log('\n============ 2. DEFI WALLET ============\n');
const dw = envKeys('.env', /DEFI_WALLET|WALLET_ADDRESS|PRIVATE_KEY|SEED|MNEMONIC/i)
  .concat(envKeys('config/.env', /DEFI_WALLET|WALLET_ADDRESS|PRIVATE_KEY|SEED|MNEMONIC/i));
if (!dw.length) console.log('  No wallet-related keys set.');
dw.forEach((k) => {
  const dangerous = /PRIVATE_KEY|SEED|MNEMONIC/i.test(k.key);
  console.log(`  ${k.key.padEnd(28)} ${mask(k.val)}${dangerous && k.val ? '   <-- SIGNING CREDENTIAL PRESENT' : ''}`);
});

console.log('\n============ 3. BITGET / EXCHANGE ============\n');
['BITGET', 'BYBIT', 'BINANCE', 'CRYPTOCOM', 'OKX'].forEach((ex) => {
  const keys = envKeys('.env', new RegExp(ex, 'i')).concat(envKeys('config/.env', new RegExp(ex, 'i')));
  if (!keys.length) { console.log(`  ${ex.padEnd(11)} not configured`); return; }
  console.log(`  ${ex}:`);
  keys.forEach((k) => console.log(`      ${k.key.padEnd(30)} ${mask(k.val)}`));
});

console.log('\n  Trading mode flags:');
['PAPER_TRADING', 'PAPER_TRADE', 'TRADING_MODE', 'LIVE_TRADING', 'INITIAL_DEPOSIT', 'LEVERAGE_MAX'].forEach((n) => {
  const k = envKeys('.env', new RegExp(`^${n}$`, 'i'))[0];
  console.log(`      ${n.padEnd(20)} ${k ? k.val : '(unset)'}`);
});

console.log('\n============ 4. EVIDENCE OF AN EDGE ============\n');
const ledgerPath = path.join(ROOT, 'data', 'trade_ledger.json');
let rows = [];
try {
  rows = fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/).filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
} catch (_) {}
const real = rows.filter((t) => t.side !== 'FLASHLOAN' && t.simulated !== true);
const wins = real.filter((t) => t.outcome === 'WIN').length;
const pnl = real.reduce((s, t) => s + (t.pnlUsd || 0), 0);
console.log(`  Real directional trades on record : ${real.length}`);
console.log(`  Wins                              : ${wins}`);
console.log(`  Net P&L                           : $${pnl.toFixed(2)}`);
console.log(`  Sample needed for a 20-trade gate : 20`);
console.log(`  Shortfall                         : ${Math.max(0, 20 - real.length)} trades`);

const port = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'portfolio_state.json'), 'utf8')); } catch (_) { return {}; } })();
console.log(`\n  Paper balance                     : $${port.currentBalance ?? '?'}  (peak $${port.sessionPeakBalance ?? '?'})`);
console.log('');
