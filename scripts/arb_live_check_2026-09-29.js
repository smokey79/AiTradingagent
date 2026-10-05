// arb_live_check_2026-09-29.js — run two real scans of the rebuilt engine (no trading, no ledger writes)
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
process.env.ARB_PERSIST_SCANS = process.env.ARB_PERSIST_SCANS || '2';
const fs = require('fs');
const eng = require('../src/arbitrage/continuousArbEngine');
const ledger = require('path').resolve(__dirname, '../data/trade_ledger.json');
(async () => {
  const before = fs.readFileSync(ledger, 'utf8');
  await eng._runScanForTest();
  const o1 = eng.getLatestOpportunities(5);
  await new Promise(r => setTimeout(r, 12000));
  await eng._runScanForTest();
  const o2 = eng.getLatestOpportunities(5);
  console.log('scan1 same-chain opps after costs:', o1.length, '| scan2:', o2.length);
  for (const o of o2) console.log(`  ${o.token} ${o.chain} ${o.buyDex}->${o.sellDex} gross ${o.grossPct.toFixed(3)}% size $${o.sizeUsd.toFixed(0)} net $${o.netUsd.toFixed(2)}`);
  console.log('status:', JSON.stringify(eng.getStatus()));
  const snap = JSON.parse(fs.readFileSync(require('path').resolve(__dirname, '../data/arb_crosschain_snapshot.json'), 'utf8'));
  console.log('cross-chain gaps (info only):', snap.gaps.slice(0, 3).map(g => `${g.token} ${g.buyChain}->${g.sellChain} ${g.grossPct}%`).join(' | '));
  console.log('trade_ledger unchanged:', before === fs.readFileSync(ledger, 'utf8'));
  process.exit(0);
})();
