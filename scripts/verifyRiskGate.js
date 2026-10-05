/**
 * scripts/verifyRiskGate.js — proves the 2026-09-15 gate corrections behave.
 * Run: node scripts/verifyRiskGate.js
 *
 * Checks Alan's two rules:
 *   1. No trade without MAJORITY consensus.
 *   2. MIN_CONFIDENCE is an absolute floor that regime logic may raise but never lower.
 */
'use strict';
process.env.PAPER_TRADING = 'true';
const { checkRiskGate } = require('../src/risk/riskGate');

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  <- ' + detail : ''}`); }
};

const market = { price: { price: 100 } };

async function gate(consensus) {
  try { return await checkRiskGate('TEST/USDT', consensus, market); }
  catch (e) { return { approved: false, reason: 'threw: ' + e.message, vetoes: [e.message] }; }
}

(async () => {
  console.log('\n=== Rule 1: majority consensus required ===');

  const minority = await gate({ signal: 'BUY', confidence: 0.95, agentsAgreeing: 2, totalAgents: 11 });
  t('2 of 11 agents is REJECTED (was allowed before — flat floor of 2)',
    !minority.approved, minority.reason);
  console.log(`        reason: ${String(minority.reason).slice(0, 120)}`);

  const belowMajority = await gate({ signal: 'BUY', confidence: 0.95, agentsAgreeing: 5, totalAgents: 11 });
  t('5 of 11 (just under majority) is REJECTED', !belowMajority.approved, belowMajority.reason);

  const zero = await gate({ signal: 'BUY', confidence: 0.95, agentsAgreeing: 0, totalAgents: 11 });
  t('0 of 11 is REJECTED (every trade logged on 2026-09-15 had 0)',
    !zero.approved, zero.reason);

  const missing = await gate({ signal: 'BUY', confidence: 0.95, totalAgents: 11 });
  t('missing agentsAgreeing is REJECTED, not treated as 0 or ignored',
    !missing.approved, missing.reason);

  console.log('\n=== Rule 2: the confidence floor (68% as of 2026-09-15) ===');

  const FLOOR = parseFloat(process.env.MIN_CONFIDENCE || '0.68');
  t(`MIN_CONFIDENCE reads as ${FLOOR} (Alan set 0.68, down from 0.72)`, FLOOR === 0.68, `got ${FLOOR}`);

  const wellUnder = await gate({ signal: 'BUY', confidence: 0.60, agentsAgreeing: 9, totalAgents: 11 });
  t('60% confidence with 9/11 agents is REJECTED — under the floor in any regime',
    !wellUnder.approved, wellUnder.reason);
  console.log(`        reason: ${String(wellUnder.reason).slice(0, 140)}`);

  const justUnder = await gate({ signal: 'BUY', confidence: 0.679, agentsAgreeing: 9, totalAgents: 11 });
  t('67.9% is REJECTED — regime can raise the bar but can no longer drop it to 65%',
    !justUnder.approved, justUnder.reason);

  console.log('\n=== Sanity: a genuinely qualifying trade is not blocked BY THESE TWO RULES ===');
  const good = await gate({ signal: 'BUY', confidence: 0.88, agentsAgreeing: 8, totalAgents: 11 });
  const blockedByOurRules = /agents agree|agentsAgreeing|Confidence .* minimum/i.test(String(good.reason || ''));
  t('88% confidence + 8/11 agents passes the consensus and confidence checks',
    !blockedByOurRules, good.reason);
  if (!good.approved) {
    console.log(`        (still rejected, but by a DIFFERENT rule — that is fine: ${String(good.reason).slice(0, 140)})`);
  }

  console.log(`\n================  ${pass} passed, ${fail} failed  ================\n`);
  process.exit(fail ? 1 : 0);
})();
