/**
 * tests/test_oanda_broker.js - offline tests for src/brokers/oandaBroker.js (no network, no orders).
 * Run from F:\aitradingagent:  node tests/test_oanda_broker.js
 */
const assert = require('assert');
const path = require('path');
process.env.OANDA_API_TOKEN = 'test-token'; process.env.OANDA_ACCOUNT_ID = '101-004-1234567-001';
process.env.OANDA_ENV = 'practice'; delete process.env.OANDA_ALLOW_LIVE; delete process.env.LEVERAGE_CAP;
const modPath = path.join(__dirname, '..', 'src', 'brokers', 'oandaBroker.js');
const load = () => { delete require.cache[require.resolve(modPath)]; return require(modPath); };

// Fake OANDA: GBP account, NAV 1000, nothing open. EUR_USD 1.1000/1.1002, 1 USD = 0.75 GBP.
function fake(navGbp = 1000, openValue = 0) {
  const calls = [];
  const http = { request: async (cfg) => {
    calls.push(cfg);
    const u = cfg.url;
    if (/\/instruments\?instruments=/.test(u)) return { status: 200, data: { instruments: [{ name: 'EUR_USD', displayPrecision: 5, tradeUnitsPrecision: 0, minimumTradeSize: '1' }] } };
    if (/\/pricing\?/.test(u)) return { status: 200, data: { prices: [{ bids: [{ price: '1.1000' }], asks: [{ price: '1.1002' }], tradeable: true }], homeConversions: [{ currency: 'USD', positionValue: '0.75' }] } };
    if (/\/summary$/.test(u)) return { status: 200, data: { account: { NAV: String(navGbp), positionValue: String(openValue), currency: 'GBP' } } };
    if (/\/candles\?/.test(u)) return { status: 200, data: { candles: [
      { complete: true, time: '1727164800.000000000', volume: 10, mid: { o: '1.1', h: '1.2', l: '1.0', c: '1.15' } },
      { complete: false, time: '1727168400.000000000', volume: 1, mid: { o: '1.15', h: '1.15', l: '1.15', c: '1.15' } }] } };
    if (cfg.method === 'POST') return { status: 201, data: { orderFillTransaction: { id: '99', units: cfg.data.order.units } } };
    return { status: 404, data: {} };
  } };
  return { http, calls };
}

(async () => {
  let o = load();
  assert.strictEqual(o.ENV, 'practice');
  assert.strictEqual(o.BASE, 'https://api-fxpractice.oanda.com');
  assert.strictEqual(o.toInstrument('EUR/USD'), 'EUR_USD');
  assert.strictEqual(o.toInstrument('WTI'), 'WTICO_USD');

  let f = fake();
  const candles = await o.getCandles('EUR/USD', '1h', 2, f.http);
  assert.strictEqual(candles.length, 1, 'incomplete candle dropped');
  assert.strictEqual(candles[0].timestamp, 1727164800000);
  assert.strictEqual(f.calls[0].headers.Authorization, 'Bearer test-token');

  await assert.rejects(() => o.placeMarketOrder('EUR/USD', 1000, {}, f.http), /stopLossPrice/);
  await assert.rejects(() => o.placeMarketOrder('EUR/USD', 1000, { stopLossPrice: 1.2 }, f.http), /wrong side/);

  // 1000 units x 1.1002 x 0.75 = 825 GBP <= 5 x 1000: allowed
  f = fake();
  const r = await o.placeMarketOrder('EUR/USD', 1000, { stopLossPrice: 1.09 }, f.http);
  const post = f.calls.find((c) => c.method === 'POST');
  assert.deepStrictEqual(post.data.order.stopLossOnFill, { price: '1.09000' });
  assert.strictEqual(post.data.order.units, '1000');
  assert.strictEqual(r.leverageAfter, 0.83);

  // 7000 units = 5775 GBP > 5000: refused, nothing sent
  f = fake();
  await assert.rejects(() => o.placeMarketOrder('EUR/USD', 7000, { stopLossPrice: 1.09 }, f.http), /Leverage cap/);
  assert.ok(!f.calls.some((c) => c.method === 'POST'), 'no order sent over the cap');

  // Live: blocked without OANDA_ALLOW_LIVE, and by the live gate on a fresh ledger
  process.env.OANDA_ENV = 'live'; o = load();
  assert.strictEqual(o.BASE, 'https://api-fxtrade.oanda.com');
  f = fake();
  await assert.rejects(() => o.placeMarketOrder('EUR/USD', 1000, { stopLossPrice: 1.09 }, f.http), /disabled/);
  process.env.OANDA_ALLOW_LIVE = 'true'; o = load();
  if (!o.liveGateStatus().passed) await assert.rejects(() => o.placeMarketOrder('EUR/USD', 1000, { stopLossPrice: 1.09 }, f.http), /Live gate not passed/);
  assert.strictEqual(f.calls.length, 0, 'no live request may be sent');

  process.env.LEVERAGE_CAP = '20'; o = load();
  assert.strictEqual(o.LEVERAGE_CAP, 5, 'leverage can never be raised above 5x');

  process.env.OANDA_ENV = 'practice'; delete process.env.OANDA_ALLOW_LIVE; delete process.env.LEVERAGE_CAP; o = load();
  await assert.rejects(() => o.getOpenPositions({ request: async () => ({ status: 401, data: {} }) }), /rejected the token/);
  console.log('oandaBroker tests passed (17 checks)');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
