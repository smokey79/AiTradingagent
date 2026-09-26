/**
 * testWalletEndpoint.js — proves /api/wallets works without starting the trader.
 * Run:  node scripts\testWalletEndpoint.js
 */
'use strict';
process.env.DASHBOARD_ONLY = 'true';   // never start autoTrader from a test
require('dotenv').config();

const PORT = process.env.TEST_DASH_PORT || '3777';
process.env.PORT = PORT;
process.env.DASHBOARD_PORT = PORT;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ', m); } else { fail++; console.log('  FAIL ', m); } };

(async () => {
  const { startServer } = require('../src/dashboard/server');
  const server = await startServer();
  await new Promise(r => setTimeout(r, 800));

  const res = await fetch(`http://127.0.0.1:${PORT}/api/wallets`);
  ok(res.ok, `GET /api/wallets -> ${res.status}`);
  const d = await res.json();

  ok(d.readOnly === true, 'endpoint reports readOnly');
  ok(d.signingEnabled === false, 'endpoint reports signing disabled');
  ok(Array.isArray(d.wallets) && d.wallets.length > 0, `${(d.wallets || []).length} wallets returned`);
  ok(d.wallets.every(w => !('privateKey' in w) && !('secret' in w)),
     'no secret field is ever serialised to the browser');

  const pooled = d.wallets.filter(w => w.pooled);
  ok(pooled.every(w => typeof w.note === 'string' && w.note.length > 0),
     'every pooled address carries an explanatory note');

  const counted = d.wallets
    .filter(w => w.ok && !w.pooled && typeof w.usd === 'number')
    .reduce((s, w) => s + w.usd, 0);
  ok(d.totalUsd === null || Math.abs(d.totalUsd - counted) < 0.01,
     'reported total equals the sum of non-pooled balances');

  const page = await fetch(`http://127.0.0.1:${PORT}/wallets.html`);
  ok(page.ok, `GET /wallets.html -> ${page.status}`);

  console.log(`\n================  ${pass} passed, ${fail} failed  ================\n`);
  server.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
