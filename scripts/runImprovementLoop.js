/**
 * runImprovementLoop.js — one analyse/improve cycle over the live ledger.
 *
 *   node scripts\runImprovementLoop.js            report only (safe, default)
 *   node scripts\runImprovementLoop.js --apply    also apply TIGHTENING changes
 *
 * --apply can only ever reduce risk. Loosening proposals are printed and
 * refused; you change those by hand, on purpose.
 */
'use strict';

const { runCycle, applyProposals, writeReport } = require('../src/learning/improvementLoop');

const commit = process.argv.includes('--apply');
const pct = v => v === null ? '  n/a' : (v * 100).toFixed(1) + '%';
const money = v => (v >= 0 ? '+' : '') + v.toFixed(2);

const r = runCycle();

console.log(`\n=== Improvement cycle — ${r.mode} mode — ${new Date(r.generatedAt).toLocaleString()} ===\n`);

console.log('Evidence');
console.log(`  ledger records        ${r.evidence.ledgerRecords}`);
console.log(`  usable for learning   ${r.evidence.resolvedLearnable}`);
console.log(`  excluded (sim/arb)    ${r.evidence.excludedFromLearning}`);
console.log(`  still open            ${r.evidence.stillOpen}`);
console.log(`  sample sufficient     ${r.evidence.sampleSufficient ? 'YES' : `NO (need ${r.evidence.minSampleRequired})`}`);

console.log('\nOverall (real trades only)');
console.log(`  trades ${r.overall.trades}   win rate ${pct(r.overall.winRate)}   net ${money(r.overall.netPnl)}`
  + `   PF ${r.overall.profitFactor === null ? 'n/a' : r.overall.profitFactor.toFixed(2)}`);

const table = (title, obj) => {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  console.log(`\n${title}`);
  for (const k of keys) {
    const s = obj[k];
    console.log(`  ${k.padEnd(12)} ${String(s.trades).padStart(4)} trades  `
      + `${pct(s.winRate).padStart(6)}  net ${money(s.netPnl)}`);
  }
};
table('By regime', r.byRegime);
table('By pair', r.byPair);

const agents = Object.entries(r.agents);
if (agents.length) {
  console.log('\nAgent directional accuracy');
  for (const [name, a] of agents) {
    console.log(`  ${name.padEnd(24)} ${String(a.withTrade).padStart(4)} votes  `
      + (a.accuracy === null ? 'below sample threshold' : pct(a.accuracy)));
  }
} else {
  console.log('\nAgent directional accuracy: no per-agent votes recorded on resolved trades yet.');
}

console.log('\nProposals');
for (const p of r.proposals) {
  const mark = p.direction === 'tighten' ? '[TIGHTEN]'
             : p.direction === 'loosen' ? '[LOOSEN — needs you]' : '[LOOK]';
  console.log(`  ${mark} ${p.title}`);
  console.log(`      ${p.detail}`);
  if (p.suggested !== undefined) console.log(`      suggested: ${p.key}=${p.suggested}`);
}

const outcome = applyProposals(r, { commit });
r.autoApplied = outcome.applied || [];
if (commit) {
  console.log(`\nApplied ${(outcome.applied || []).length} tightening change(s). `
    + `.env backed up first.`);
  if (outcome.refused.length) console.log(`Refused ${outcome.refused.length} loosening proposal(s).`);
} else if (outcome.wouldApply.length) {
  console.log(`\n${outcome.wouldApply.length} change(s) would be applied with --apply. Nothing written.`);
}

const p = writeReport(r);
console.log(`\nReport written: ${p}\n`);
