/**
 * testImprovementLoop.js — validates the learning loop against a SYNTHETIC
 * ledger, so the checks do not depend on whatever the live ledger happens to
 * contain. Writes to a temp dir; the real data/ folder is untouched.
 *
 * Run:  node scripts\testImprovementLoop.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ', m); } else { fail++; console.log('  FAIL ', m); } };

// Build a fake project root with a synthetic ledger.
// Sandbox lives INSIDE the project so node can still resolve node_modules
// (dotenv) by walking up. Removed at the end of the run.
const tmp = fs.mkdtempSync(path.join(__dirname, '..', '.tmp-loop-test-'));
fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'src', 'learning'), { recursive: true });
fs.copyFileSync(
  path.join(__dirname, '..', 'src', 'learning', 'improvementLoop.js'),
  path.join(tmp, 'src', 'learning', 'improvementLoop.js')
);

const rows = [];
// 40 real losing trades, "goodAgent" right 80% of the time, "badAgent" right 20%.
for (let i = 0; i < 40; i++) {
  const win = i % 5 === 0;                       // 20% win rate (8 of 40)
  // goodAgent calls it right on 32 of 40 (80%); badAgent on the other 8 (20%).
  // "Right" = backed a winner, or opposed a loser.
  const goodIsRight = i % 5 !== 1;
  const rightCall = win ? 'BUY' : 'SELL';
  const wrongCall = win ? 'SELL' : 'BUY';
  rows.push({
    id: `T${i}`, pair: 'BTC/USDT', side: 'BUY', outcome: win ? 'WIN' : 'LOSS',
    pnlUsd: win ? 4 : -2, regime: 'BEAR', totalAgents: 5, agentsAgreeing: 3,
    agentVotes: {
      goodAgent: { signal: goodIsRight ? rightCall : wrongCall },
      badAgent:  { signal: goodIsRight ? wrongCall : rightCall },
      quietAgent: { signal: 'HOLD' },
    },
  });
}
// Phantom records that must never reach the statistics.
rows.push({ id: 'P1', pair: 'BTC/USDT', side: 'FLASHLOAN', outcome: 'WIN', pnlUsd: 105.94 });
rows.push({ id: 'P2', pair: 'ETH/USDT', side: 'BUY', outcome: 'WIN', pnlUsd: 500, simulated: true });
rows.push({ id: 'P3', pair: 'ETH/USDT', side: 'BUY', outcome: 'WIN', pnlUsd: 500, excludeFromLearning: true });
rows.push({ id: 'O1', pair: 'ETH/USDT', side: 'BUY', outcome: 'PENDING', pnlUsd: 0 });

fs.writeFileSync(path.join(tmp, 'data', 'trade_ledger.json'),
  rows.map(r => JSON.stringify(r)).join('\n') + '\n');

process.env.LEARN_MIN_SAMPLE = '30';
process.env.LEARN_MIN_AGENT_SAMPLE = '20';
process.env.MIN_CONFIDENCE = '0.68';

const loop = require(path.join(tmp, 'src', 'learning', 'improvementLoop.js'));
const r = loop.runCycle();

console.log('\nEvidence handling\n');
ok(r.evidence.ledgerRecords === 44, `all 44 records read (got ${r.evidence.ledgerRecords})`);
ok(r.overall.trades === 40, `only the 40 real trades are learned from (got ${r.overall.trades})`);
ok(r.evidence.excludedFromLearning === 3, 'the 3 phantom/simulated records are excluded');
ok(r.evidence.stillOpen === 1, 'the open trade is not counted as an outcome');

console.log('\nArithmetic\n');
ok(Math.abs(r.overall.netPnl - (8 * 4 - 32 * 2)) < 1e-9,
   `net P&L reads pnlUsd correctly (got ${r.overall.netPnl}, expected -32)`);
ok(r.overall.netPnl < 0, 'a losing ledger is reported as losing, not flat');
ok(Math.abs(r.overall.winRate - 0.2) < 1e-9, `win rate 20% (got ${(r.overall.winRate * 100).toFixed(1)}%)`);

console.log('\nAgent attribution\n');
ok(Math.abs(r.agents.goodAgent.accuracy - 0.8) < 1e-9, 'goodAgent scored 80%');
ok(Math.abs(r.agents.badAgent.accuracy - 0.2) < 1e-9, 'badAgent scored 20%');
ok(!r.agents.quietAgent, 'an agent that only ever says HOLD is not scored');

console.log('\nProposals\n');
const titles = r.proposals.map(p => p.title).join(' | ');
ok(r.proposals.some(p => p.key === 'MIN_CONFIDENCE' && p.direction === 'tighten'),
   'proposes raising the confidence floor on a losing ledger');
ok(r.proposals.some(p => p.key === 'AGENT_DEMOTE_badAgent'), 'proposes demoting badAgent');
ok(!r.proposals.some(p => p.key === 'AGENT_DEMOTE_goodAgent'), 'does not demote the accurate agent');
ok(r.proposals.every(p => p.direction !== 'loosen'), 'never proposes loosening off a losing ledger');

console.log('\nSafety of --apply\n');
const dry = loop.applyProposals(r, { commit: false });
ok(dry.committed === false, 'default run writes nothing');
ok(dry.wouldApply.every(p => p.direction === 'tighten'), 'only tightening changes are ever applicable');

// Small-sample refusal
fs.writeFileSync(path.join(tmp, 'data', 'trade_ledger.json'),
  rows.slice(0, 5).map(r2 => JSON.stringify(r2)).join('\n') + '\n');
const small = loop.runCycle();
ok(small.evidence.sampleSufficient === false, 'a 5-trade ledger is flagged as insufficient');
ok(small.proposals.length === 1 && small.proposals[0].direction === 'investigate',
   'no parameter is tuned on a 5-trade sample');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n================  ${pass} passed, ${fail} failed  ================\n`);
process.exit(fail === 0 ? 0 : 1);
