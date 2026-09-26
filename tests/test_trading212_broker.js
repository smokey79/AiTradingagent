/**
 * tests/test_trading212_broker.js - offline tests (no network, no orders).
 * Run from F:\aitradingagent:  node tests/test_trading212_broker.js
 */
const assert = require('assert');
process.env.T212_API_KEY = 'testkey'; process.env.T212_API_SECRET = 'testsecret';
process.env.T212_ENV = 'demo';
const path = require('path');
const modPath = path.join(__dirname, '..', 'src', 'brokers', 'trading212Broker.js');
const load = () => { delete require.cache[require.resolve(modPath)]; return require(modPath); };

(async () => {
  let t = load();
  assert.strictEqual(t.ENV, 'demo');
  assert.ok(t.BASE.startsWith('https://demo.trading212.com'));
  assert.strictEqual(t._authHeader(), 'Basic ' + Buffer.from('testkey:testsecret').toString('base64'));

  const calls = [];
  const fakeHttp = { request: async (cfg) => { calls.push(cfg); return { status: 200, data: { id: 1, ...cfg.data } }; } };
  const r = await t.placeMarketOrder('MSTR_US_EQ', 1, {}, fakeHttp);
  assert.strictEqual(calls[0].url, 'https://demo.trading212.com/api/v0/equity/orders/market');
  assert.deepStrictEqual(calls[0].data, { ticker: 'MSTR_US_EQ', quantity: 1 });
  assert.strictEqual(r.ticker, 'MSTR_US_EQ');

  await assert.rejects(() => t.placeMarketOrder('MSTR_US_EQ', 0, {}, fakeHttp), /non-zero/);

  process.env.T212_ENV = 'live'; delete process.env.T212_ALLOW_LIVE;
  t = load();
  await assert.rejects(() => t.placeMarketOrder('MSTR_US_EQ', 1, {}, fakeHttp), /disabled/);
  process.env.T212_ALLOW_LIVE = 'true';
  t = load();
  // Live gate is not passed on a fresh ledger, so the order must still be blocked.
  const g = t.liveGateStatus();
  if (!g.passed) await assert.rejects(() => t.placeMarketOrder('MSTR_US_EQ', 1, {}, fakeHttp), /Live gate not passed/);
  assert.strictEqual(calls.length, 1, 'no live request may be sent');

  const errHttp = { request: async () => ({ status: 401, data: {} }) };
  process.env.T212_ENV = 'demo'; t = load();
  await assert.rejects(() => t.getPositions(errHttp), /rejected the API key/);
  console.log('trading212Broker tests passed (8 checks)');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
