/**
 * scripts/testTraderDevFix.js — proves the TraderDev agent no longer emits a
 * permanent BUY off selection-biased leaderboard numbers.
 *
 * Run: node scripts/testTraderDevFix.js
 */
'use strict';
require('dotenv').config();
const agent = require('../src/agents/traderDevAgent');

const entry = agent.getSignal || agent.run || agent.analyze || agent.evaluate;

(async () => {
  if (typeof entry !== 'function') {
    console.log('Exports found:', Object.keys(agent).join(', '));
    process.exit(1);
  }

  let pass = 0, fail = 0;
  const t = (n, c, d) => { c ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (d ? '  <- ' + d : ''))); };

  console.log('\nLive TraderDev calls (real API)\n');

  for (const sym of ['BTC', 'ETH']) {
    let r;
    try { r = await entry(sym, {}); }
    catch (e) { console.log(`  ${sym}: threw — ${e.message}`); fail++; continue; }

    console.log(`  ${sym}: signal=${r.signal}  confidence=${r.confidence}`);
    console.log(`      ${String(r.reason).slice(0, 200)}`);

    t(`${sym} does not emit a BUY off leaderboard Sharpe`, r.signal !== 'BUY',
      `got ${r.signal}`);
    t(`${sym} confidence is not inflated above 0.7`, (r.confidence || 0) <= 0.7,
      `got ${r.confidence}`);
    const mentionsBias = /selection bias|non-directional|plausibility/i.test(String(r.reason || ''));
    t(`${sym} reason explains why it abstained`, mentionsBias, String(r.reason).slice(0, 80));
    console.log('');
  }

  console.log(`================  ${pass} passed, ${fail} failed  ================\n`);
  process.exit(fail ? 1 : 0);
})();
