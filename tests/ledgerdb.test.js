// tests/ledgerdb.test.js (2026-10-03) -- SQLite ledger mirror (src/utils/ledgerDb.js). Temp database only.
// Run: node tests/ledgerdb.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerdb-'));
process.env.LEDGER_DB_PATH = path.join(tmp, 'ledger.db');
const db = require('../src/utils/ledgerDb');
let pass = 0;
function t(name, fn) { try { fn(); pass++; console.log('PASS', name); } catch (e) { console.log('FAIL', name, '-', e.message); process.exitCode = 1; } }

const row = (o) => ({ id: 'x', timestamp: '2026-10-03T10:00:00.000Z', pair: 'BTC/USDT', side: 'BUY', price: 100, positionSizeUsd: 25, leverage: 1,
  pnlUsd: 1, pnlPct: 1, outcome: 'WIN', paper: true, ...o });

t('real, fee-inclusive, closed trade is a real_trade', () => {
  db.upsertTrade(row({ id: 'r1', costUsd: 0.04 }));
  assert.strictEqual(db.realTrades().length, 1);
  assert.strictEqual(db.realTrades()[0].source, 'dry_run'); assert.strictEqual(db.realTrades()[0].fees_included, 1);
});
t('no cost recorded -> stored but NOT real', () => {
  db.upsertTrade(row({ id: 'r2' }));
  assert.strictEqual(db.counts().total, 2); assert.strictEqual(db.counts().real, 1);
});
t('flash-loan record -> simulated, NOT real', () => {
  db.upsertTrade(row({ id: 'r3', side: 'FLASHLOAN', costUsd: 0.1, pnlUsd: 80 }));
  assert.strictEqual(db.counts().simulated, 1); assert.strictEqual(db.counts().real, 1);
});
t('explicitly simulated record -> NOT real', () => {
  db.upsertTrade(row({ id: 'r4', costUsd: 0.04, isSimulated: true }));
  assert.strictEqual(db.counts().real, 1);
});
t('pending trade is not real until it resolves; the same id then updates in place', () => {
  db.upsertTrade(row({ id: 'r5', outcome: 'PENDING', costUsd: 0.04, pnlUsd: 0 }));
  assert.strictEqual(db.counts().real, 1);
  db.upsertTrade(row({ id: 'r5', outcome: 'LOSS', costUsd: 0.04, pnlUsd: -2 }));
  assert.strictEqual(db.counts().real, 2); assert.strictEqual(db.counts().total, 5);
});
t('upsert is idempotent', () => { db.upsertTrade(row({ id: 'r1', costUsd: 0.04 })); assert.strictEqual(db.counts().total, 5); });
t('live source is kept as live', () => {
  db.upsertTrade(row({ id: 'r6', costUsd: 0.04, paper: false }));
  assert.ok(db.realTrades().some((r) => r.ext_id === 'r6' && r.source === 'live'));
});
t('schema file is shared with Python', () => assert.ok(fs.readFileSync(db.SCHEMA_PATH, 'utf8').includes('CREATE VIEW real_trades')));

db.close();
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) { console.log('note: temp folder left behind', tmp); }
console.log(`${pass} passed`);
