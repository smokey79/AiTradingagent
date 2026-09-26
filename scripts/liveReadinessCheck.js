/**
 * scripts/liveReadinessCheck.js — measures the system against Alan's OWN
 * stated pre-funding gate before PAPER_TRADING is ever set to false.
 * Read-only. Never changes a setting, never places an order.
 *
 * Run: node scripts/liveReadinessCheck.js
 *
 * The gate (agreed 2026-09-15): 30+ real closed paper trades, positive net
 * P&L, profit factor > 1.2, and a working agent roster. Plus the project's
 * own hard rule: simulated / excludeFromLearning / FLASHLOAN records never
 * count toward evidence.
 */
'use strict';
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const results = [];
const add = (pass, label, detail) => results.push({ pass, label, detail });

// ── 1. Real closed trades ────────────────────────────────────────────────
let real = [];
try {
  const raw = fs.readFileSync(path.join(ROOT, 'data', 'trade_ledger.json'), 'utf8');
  const all = raw.split('\n').filter((l) => l.trim()).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  real = all.filter((t) =>
    !t.simulated && !t.excludeFromLearning &&
    String(t.side || '').toUpperCase() !== 'FLASHLOAN' &&
    typeof t.pnlUsd === 'number');
  add(real.length >= 30, `Sample size: ${real.length} real closed trades`, 'need 30+');
} catch (e) {
  add(false, 'Sample size: ledger unreadable', e.message);
}

// ── 2. Net P&L and profit factor ─────────────────────────────────────────
if (real.length) {
  const net = real.reduce((s, t) => s + t.pnlUsd, 0);
  const gains = real.filter((t) => t.pnlUsd > 0).reduce((s, t) => s + t.pnlUsd, 0);
  const losses = Math.abs(real.filter((t) => t.pnlUsd < 0).reduce((s, t) => s + t.pnlUsd, 0));
  const pf = losses === 0 ? (gains > 0 ? Infinity : 0) : gains / losses;
  const wins = real.filter((t) => t.pnlUsd > 0).length;
  add(net > 0, `Net P&L: $${net.toFixed(2)}`, 'need > $0');
  add(pf > 1.2, `Profit factor: ${Number.isFinite(pf) ? pf.toFixed(2) : 'n/a'}`, 'need > 1.20');
  add(true, `Win rate: ${((wins / real.length) * 100).toFixed(1)}% (${wins}/${real.length})`, 'context only');

  const timedOut = real.filter((t) => /timed out/i.test(t.reason || '')).length;
  add(timedOut < real.length, `Exits on timer: ${timedOut}/${real.length}`,
    'if all exits are the timer, outcomes are noise not strategy');
} else {
  add(false, 'Net P&L / profit factor: no usable trades', 'cannot evaluate');
}

// ── 3. Agent roster health ───────────────────────────────────────────────
try {
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'agent_health.json'), 'utf8'));
  const names = Object.keys(h);
  const degraded = names.filter((n) => String(h[n].status).toUpperCase() === 'DEGRADED');
  add(degraded.length === 0, `Agent roster: ${degraded.length}/${names.length} DEGRADED`,
    degraded.length ? degraded.join(', ') : 'all responding');
} catch (e) {
  add(false, 'Agent roster: health file unreadable', e.message);
}

// ── 4. Safety configuration ──────────────────────────────────────────────
const paper = String(process.env.PAPER_TRADING).toLowerCase() === 'true';
add(paper, `PAPER_TRADING=${process.env.PAPER_TRADING}`, 'must stay true until every row above passes');

const lev = parseFloat(process.env.LEVERAGE_MAX || '1');
add(lev <= 1, `LEVERAGE_MAX=${lev}`,
  'leveraged crypto derivatives are FCA-banned for UK retail — 1x spot only');

const sandbox = String(process.env.BITGET_SANDBOX).toLowerCase() === 'true';
const testnet = String(process.env.BITGET_TESTNET).toLowerCase() === 'true';
add(sandbox || testnet, `BITGET_SANDBOX=${process.env.BITGET_SANDBOX} / BITGET_TESTNET=${process.env.BITGET_TESTNET}`,
  'both false means live keys — flipping PAPER_TRADING would place REAL orders immediately');

// ── 5. Conflicting config ────────────────────────────────────────────────
try {
  const a = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  const b = fs.readFileSync(path.join(ROOT, 'config', '.env'), 'utf8');
  const get = (txt, key) => {
    const m = txt.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm'));
    return m ? m[1].split('#')[0].trim() : null;
  };
  const conflicts = ['MIN_CONFIDENCE', 'TRADING_PAIRS', 'PAPER_TRADING']
    .map((k) => ({ k, a: get(a, k), b: get(b, k) }))
    .filter((c) => c.a && c.b && c.a !== c.b);
  add(conflicts.length === 0, `Config conflicts between .env and config/.env: ${conflicts.length}`,
    conflicts.map((c) => `${c.k}: root="${String(c.a).slice(0, 40)}" vs config="${String(c.b).slice(0, 40)}"`).join(' | ') || 'none');
} catch (e) {
  add(false, 'Config conflict check failed', e.message);
}

// ── Verdict ──────────────────────────────────────────────────────────────
console.log('\n  LIVE-TRADING READINESS — measured, not asserted\n');
let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.label}`);
  if (r.detail) console.log(`        ${r.detail}`);
}
console.log(`\n  ${results.length - failed}/${results.length} checks pass.`);
console.log(failed === 0
  ? '\n  All gates clear. The decision to go live is still yours alone.\n'
  : `\n  NOT READY: ${failed} gate(s) failing. PAPER_TRADING must stay true.\n`);
process.exitCode = failed === 0 ? 0 : 1;
