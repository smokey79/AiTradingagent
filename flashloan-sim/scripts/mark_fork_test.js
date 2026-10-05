// flashloan-sim/scripts/mark_fork_test.js  (2026-10-03)
// Decides whether flash-loan arbitrage may ever leave observation-only mode.
// Reads the newest results/forkTest_*.json and writes results/fork_test_passed.json:
//   passed = true  ONLY IF every check is ok AND the edge scan found at least one route profitable after gas.
// The bot (src/utils/realism.js liveArbAllowed / core/realism.py live_arb_allowed) also needs ARB_MODE=live.
// Run:  node flashloan-sim/scripts/mark_fork_test.js
'use strict';
const fs = require('fs');
const path = require('path');

const RESULTS = path.resolve(__dirname, '..', 'results');
const files = fs.readdirSync(RESULTS).filter((f) => /^forkTest_.*\.json$/.test(f))
  .map((f) => ({ f, t: fs.statSync(path.join(RESULTS, f)).mtimeMs })).sort((a, b) => b.t - a.t);
if (!files.length) { console.error('No forkTest_*.json found. Run forktest.ps1 first.'); process.exit(1); }

const latest = files[0].f;
const data = JSON.parse(fs.readFileSync(path.join(RESULTS, latest), 'utf8'));
const checks = data.checks || [];
const failed = checks.filter((c) => !c.ok);
const edge = checks.find((c) => /edge scan/i.test(c.name));
const m = edge && /(\d+) of (\d+) routes profitable/.exec(edge.detail || '');
const profitable = m ? Number(m[1]) : 0;
const total = m ? Number(m[2]) : 0;

const reasons = [];
if (failed.length) reasons.push(`${failed.length} check(s) failed: ${failed.map((c) => c.name).join(', ')}`);
if (!m) reasons.push('edge scan result not found in the fork-test output');
if (profitable < 1) reasons.push(`edge scan: ${profitable} of ${total} routes profitable after gas (need at least 1)`);

const out = { passed: reasons.length === 0, at: new Date().toISOString(), source: latest,
  checks: checks.length, profitableRoutes: profitable, totalRoutes: total, reasons };
fs.writeFileSync(path.join(RESULTS, 'fork_test_passed.json'), JSON.stringify(out, null, 2));
console.log(out.passed ? 'FORK TEST PASSED (live arbitrage still also needs ARB_MODE=live).' : 'NOT passed -> flash-loan arbitrage stays observation-only.');
reasons.forEach((r) => console.log('  - ' + r));
