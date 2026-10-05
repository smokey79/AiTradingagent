// tests/arb.test.js (2026-10-03) -- offline tests for the arbitrage module + predictor memory. Uses temp databases, no network, no real files touched.
// Run: node tests/arb.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arbtest-'));
process.env.ARB_DB_PATH = path.join(tmp, 'arb.db');
process.env.PREDICTIONS_DB_PATH = path.join(tmp, 'pred.db');
process.env.PREDICTOR_LLM = 'false';
process.env.ARB_SYMBOLS = 'TEST/USDT';
process.env.ARB_EXCHANGES = 'a,b';
process.env.ARB_MODE = 'observe';

const math = require('../src/arb/math');
const memory = require('../src/arb/memory');
const store = require('../src/predictor/predictionStore');
const predictor = require('../src/predictor/predictorAgent');
const exchanges = require('../src/arb/exchanges');
const agent = require('../src/arb/arbAgent');

let pass = 0, fail = 0;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
async function t(name, fn) { try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } }

(async () => {
  await t('buyVwap walks the asks', () => {
    const r = math.buyVwap([[100, 1], [101, 2]], 150);
    near(r.spent, 150); near(r.qty, 1 + 50 / 101); assert.ok(r.filled);
  });
  await t('net result subtracts fees, latency and rebalancing', () => {
    const r = math.netOpportunity({ asks: [[100, 5]], bids: [[101, 5]], notionalUsd: 100, feeBuyPct: 0.1, feeSellPct: 0.1, latencyPctPerSide: 0.03, rebalancePct: 0.05 });
    assert.ok(r.ok); near(r.grossUsd, 1); near(r.feesUsd, 0.1 + 0.101); near(r.latencyUsd, 0.06); near(r.rebalanceUsd, 0.05); near(r.netUsd, 1 - 0.201 - 0.06 - 0.05);
  });
  await t('a 0.1% spread is NOT profitable after costs', () => {
    const r = math.netOpportunity({ asks: [[100, 5]], bids: [[100.1, 5]], notionalUsd: 100, feeBuyPct: 0.1, feeSellPct: 0.1 });
    assert.ok(r.ok && r.netUsd < 0, `net ${r.netUsd}`);
  });
  await t('thin books are rejected, not filled in imagination', () => {
    assert.strictEqual(math.netOpportunity({ asks: [[100, 0.1]], bids: [[101, 5]], notionalUsd: 100, feeBuyPct: 0.1, feeSellPct: 0.1 }).ok, false);
    assert.strictEqual(math.netOpportunity({ asks: [[100, 5]], bids: [[101, 0.1]], notionalUsd: 100, feeBuyPct: 0.1, feeSellPct: 0.1 }).ok, false);
  });
  await t('suggested size is at most half the visible depth', () => {
    near(math.suggestNotional([[100, 1]], [[100, 10]], 1000), 50);
    near(math.suggestNotional([[100, 100]], [[100, 100]], 100), 100);
  });

  await t('arb ledger: P/L, win rate, profit factor, drawdown', () => {
    const base = { symbol: 'X/USDT', buyEx: 'a', sellEx: 'b', notionalUsd: 100, buyAvg: 1, sellAvg: 1, qty: 1, grossUsd: 0, feesUsd: 0, latencyUsd: 0, rebalanceUsd: 0, netPct: 0 };
    memory.recordTrade({ ...base, netUsd: 1 }); memory.recordTrade({ ...base, netUsd: -0.5 }); memory.recordTrade({ ...base, netUsd: 0.25 });
    const s = memory.summary(1000);
    assert.strictEqual(s.trades, 3); assert.strictEqual(s.wins, 2); near(s.netUsd, 0.75); near(s.profitFactor, 1.25 / 0.5, 1e-3); near(s.maxDrawdownUsd, 0.5); near(s.equity, 1000.75);
  });
  await t('route memory: persistence is smoothed and grows with evidence', () => {
    for (let i = 0; i < 6; i++) memory.recordObservation({ symbol: 'R/USDT', buyEx: 'a', sellEx: 'b', grossPct: 0.5, netPct: 0.2, notionalUsd: 50, persisted: i > 0 });
    const m = memory.routeStats('R/USDT', 'a', 'b');
    assert.strictEqual(m.n, 6); assert.strictEqual(m.profitable, 6); assert.ok(m.persistenceRate > 0.6, `rate ${m.persistenceRate}`);
    assert.strictEqual(memory.routeStats('NONE/USDT', 'a', 'b').n, 0);
  });

  await t('prediction store: scores a price prediction against the real price after the horizon', () => {
    const t0 = Date.now() - 3 * 3600 * 1000;
    const up = store.record({ scope: 'trade', kind: 'price', key: 'BTC/USDT', horizonMin: 60, direction: 'UP', probability: 0.7, entryPrice: 100, nowMs: t0 });
    const dn = store.record({ scope: 'trade', kind: 'price', key: 'BTC/USDT', horizonMin: 60, direction: 'DOWN', probability: 0.6, entryPrice: 100, nowMs: t0 });
    assert.strictEqual(store.resolveDuePrice('trade', 'BTC/USDT', 101).length, 2);
    const s = store.stats('trade');
    assert.strictEqual(s.resolved, 2); near(s.hitRate, 0.5); near(s.brier, ((0.7 - 1) ** 2 + (0.6 - 0) ** 2) / 2, 1e-3);
    assert.ok(up && dn);
  });
  await t('prediction store: a not-yet-due prediction is NOT scored early', () => {
    store.record({ scope: 'trade', kind: 'price', key: 'ETH/USDT', horizonMin: 120, direction: 'UP', probability: 0.6, entryPrice: 100 });
    assert.strictEqual(store.resolveDuePrice('trade', 'ETH/USDT', 120).length, 0);
  });
  await t('calibration needs history before it changes anything', () => {
    const c = store.calibrate('trade', 0.8); assert.strictEqual(c.weight, 0); near(c.p, 0.8);
  });

  await t('predictTrade: bullish evidence -> UP, recorded in memory', () => {
    const p = predictor.predictTrade({ pair: 'SOL/USDT', price: 110, indicators: { ema20: 108, ema50: 100, rsi14: 62, macd: { histogram: 0.5 }, atr14: 2 },
      consensus: { signal: 'BUY', confidence: 0.8 }, debate: { bullConfidence: 0.8, bearConfidence: 0.2 } });
    assert.strictEqual(p.direction, 'UP'); assert.ok(p.probability > 0.5 && p.probability <= 0.85); assert.ok(p.agreesWithConsensus); assert.ok(p.id > 0);
  });
  await t('predictTrade: bear veto + bearish evidence -> DOWN, and it disagrees with a BUY consensus', () => {
    const p = predictor.predictTrade({ pair: 'SOL/USDT', price: 90, indicators: { ema20: 92, ema50: 100, rsi14: 40, macd: { histogram: -1 }, atr14: 2 },
      consensus: { signal: 'BUY', confidence: 0.3 }, debate: { bullConfidence: 0.2, bearConfidence: 0.8, bearVeto: true } });
    assert.strictEqual(p.direction, 'DOWN'); assert.strictEqual(p.agreesWithConsensus, false);
  });
  await t('predictTrade with no data stays FLAT at 0.5 (does not invent confidence)', () => {
    const p = predictor.predictTrade({ pair: 'NONE/USDT', price: 0, indicators: {}, consensus: {}, debate: {} });
    assert.strictEqual(p.direction, 'FLAT'); near(p.probability, 0.5);
  });
  await t('predictArb: unknown route starts near the 0.35 prior; strong evidence raises it', () => {
    const weak = predictor.predictArb({ symbol: 'Q/USDT', buyEx: 'a', sellEx: 'b', netPct: 0.05, grossPct: 0.3, depthRatio: 1, memory: { n: 0 }, debate: {} });
    const strong = predictor.predictArb({ symbol: 'Q/USDT', buyEx: 'a', sellEx: 'b', netPct: 0.6, grossPct: 0.9, depthRatio: 6, memory: { n: 40, persistenceRate: 0.7 }, debate: { bullConfidence: 0.8, bearConfidence: 0.2 } });
    assert.ok(weak.probability < 0.35, `weak ${weak.probability}`); assert.ok(strong.probability > 0.7, `strong ${strong.probability}`);
  });

  await t('debate falls back to a heuristic when no LLM is available', async () => {
    const d = await agent.debate({ symbol: 'T/USDT', buyEx: 'a', sellEx: 'b', grossPct: 1, netPct: 0.6, notionalUsd: 100, depthRatio: 5, feesUsd: 0.2, latencyUsd: 0.06, rebalanceUsd: 0.05 },
      { n: 3, profitableShare: 0.5, persistenceRate: 0.4 });
    assert.strictEqual(d.source, 'heuristic'); assert.ok(d.bullConfidence >= 0 && d.bullConfidence <= 1 && d.bearConfidence >= 0 && d.bearConfidence <= 1);
  });

  // ---- full scan with fake exchanges (monkey-patched, no network)
  const quotes = { a: { 'TEST/USDT': { bid: 99.9, ask: 100, taker: 0.001 } }, b: { 'TEST/USDT': { bid: 101, ask: 101.1, taker: 0.001 } } };
  exchanges.fetchQuotes = async (n) => quotes[n];
  exchanges.fetchBook = async (n) => (n === 'a' ? { asks: [[100, 10]], bids: [[99.9, 10]] } : { asks: [[101.1, 10]], bids: [[101, 10]] });
  const tradesNow = () => memory.summary().trades;

  await t('scan 1: a fresh spread is only observed, never traded (must persist across two scans)', async () => {
    const before = tradesNow(); await agent.scanOnce(); assert.strictEqual(tradesNow(), before);
  });
  await t('scan 2: the persisting, predictor-approved spread becomes ONE paper trade with a cost breakdown', async () => {
    const before = tradesNow(); await agent.scanOnce(); assert.strictEqual(tradesNow(), before + 1);
    const last = memory.recentTrades(1)[0];
    assert.strictEqual(last.symbol, 'TEST/USDT'); assert.ok(last.net_usd > 0 && last.fees_usd > 0 && last.latency_usd > 0 && last.rebalance_usd > 0); assert.ok(/PAPER/.test(last.note));
    assert.ok(last.prediction_id > 0 && last.predicted_p >= 0.55);
  });
  await t('a spread that vanished is scored as "did not persist" on the next scan', async () => {
    const key = 'TEST/USDT|a>b';
    store.record({ scope: 'arb', kind: 'event', key, horizonMin: 1, direction: 'PERSISTS', probability: 0.8, nowMs: Date.now() - 5 * 60000 });
    const n = agent.resolveDuePredictions(new Map()); assert.ok(n >= 1);
    const s = store.stats('arb'); assert.ok(s.resolved >= 1);
  });
  await t('live mode requested while locked: still no trade', async () => {
    process.env.ARB_MODE = 'live';
    const before = tradesNow(); await agent.scanOnce(); await agent.scanOnce(); assert.strictEqual(tradesNow(), before);
    process.env.ARB_MODE = 'observe';
  });
  await t('only one exchange answering -> scan does nothing instead of inventing a spread', async () => {
    exchanges.fetchQuotes = async (n) => (n === 'a' ? quotes.a : {});
    const before = tradesNow(); const r = await agent.scanOnce(); assert.strictEqual(r.exchanges, 1); assert.strictEqual(tradesNow(), before);
  });

  memory.close(); store.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
