/**
 * tests/test_alpaca_broker.js - offline tests for src/brokers/alpacaBroker.js
 * (no network, no orders). Run from F:\aitradingagent:  node tests/test_alpaca_broker.js
 */
const assert = require('assert');
const path = require('path');
process.env.APCA_API_KEY_ID = 'test-key'; process.env.APCA_API_SECRET_KEY = 'test-secret';
process.env.ALPACA_ENV = 'paper'; delete process.env.ALPACA_ALLOW_LIVE;
const modPath = path.join(__dirname, '..', 'src', 'brokers', 'alpacaBroker.js');
const load = () => { delete require.cache[require.resolve(modPath)]; return require(modPath); };

function fake() {
  const calls = [];
  const http = { request: async (cfg) => {
    calls.push(cfg);
    const u = cfg.url;
    if (/\/v2\/stocks\/AAPL\/trades\/latest/.test(u)) return { status: 200, data: { trade: { p: 200.0, t: '2026-09-26T12:00:00Z' } } };
    if (/\/v1beta3\/crypto\/us\/latest\/trades/.test(u)) return { status: 200, data: { trades: { 'BTC/USD': { p: 65000.0, t: '2026-09-26T12:00:00Z' } } } };
    if (/\/v2\/stocks\/AAPL\/bars/.test(u)) return { status: 200, data: { bars: [
      { t: '2026-09-26T10:00:00Z', o: 199, h: 201, l: 198, c: 200, v: 1000 },
    ] } };
    if (cfg.method === 'POST') return { status: 200, data: { id: 'ord-1', ...cfg.data } };
    return { status: 404, data: {} };
  } };
  return { http, calls };
}

(async () => {
  let a = load();
  assert.strictEqual(a.ENV, 'paper');
  assert.strictEqual(a.BASE, 'https://paper-api.alpaca.markets');
  assert.strictEqual(a.isCryptoSymbol('BTC/USD'), true);
  assert.strictEqual(a.isCryptoSymbol('AAPL'), false);

  let f = fake();
  const px = await a.getPrice('AAPL', f.http);
  assert.strictEqual(px.price, 200.0);
  assert.strictEqual(f.calls[0].headers['APCA-API-KEY-ID'], 'test-key');

  const cpx = await a.getPrice('BTC/USD', f.http);
  assert.strictEqual(cpx.price, 65000.0);

  const candles = await a.getCandles('AAPL', '1h', 10, f.http);
  assert.strictEqual(candles.length, 1);
  assert.strictEqual(candles[0].close, 200);

  // No stop loss -> refused before any network call for the order itself
  await assert.rejects(() => a.placeMarketOrder('AAPL', 'BUY', { notionalUsd: 100 }, f.http), /stopLossPrice/);
  // No size -> refused
  await assert.rejects(() => a.placeMarketOrder('AAPL', 'BUY', { stopLossPrice: 190 }, f.http), /notionalUsd or qty/);
  // Stop on wrong side of price (200) for a BUY
  await assert.rejects(() => a.placeMarketOrder('AAPL', 'BUY', { stopLossPrice: 210, notionalUsd: 100 }, f.http), /wrong side/);

  f = fake();
  const r = await a.placeMarketOrder('AAPL', 'BUY', { stopLossPrice: 190, takeProfitPrice: 220, notionalUsd: 100 }, f.http);
  const post = f.calls.find((c) => c.method === 'POST');
  assert.strictEqual(post.data.order_class, 'bracket');
  assert.strictEqual(post.data.stop_loss.stop_price, '190.00');
  assert.strictEqual(post.data.take_profit.limit_price, '220.00');
  assert.strictEqual(r.env, 'paper');

  // Live: blocked without ALPACA_ALLOW_LIVE
  process.env.ALPACA_ENV = 'live'; a = load();
  assert.strictEqual(a.BASE, 'https://api.alpaca.markets');
  f = fake();
  await assert.rejects(() => a.placeMarketOrder('AAPL', 'BUY', { stopLossPrice: 190, notionalUsd: 100 }, f.http), /disabled/);
  assert.strictEqual(f.calls.length, 0, 'no live request may be sent without the flag');

  process.env.ALPACA_ENV = 'paper'; delete process.env.ALPACA_ALLOW_LIVE; a = load();
  await assert.rejects(() => a.getOpenPositions({ request: async () => ({ status: 401, data: {} }) }), /rejected the key/);

  console.log('alpacaBroker tests passed (13 checks)');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
