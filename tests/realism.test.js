// tests/realism.test.js (2026-10-03) -- unit tests for src/utils/realism.js. No network, no live data.
// Run: node tests/realism.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const realism = require('../src/utils/realism');
let pass = 0;
function t(name, fn) { try { fn(); pass++; console.log('PASS', name); } catch (e) { console.log('FAIL', name, '-', e.message); process.exitCode = 1; } }
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

// ---- costs
t('default costs: 0.06% fee + 0.02% slippage per side, 0.16% round trip', () => {
  near(realism.feePctPerSide(), 0.06); near(realism.slippagePctPerSide(), 0.02);
  near(realism.costFractionPerSide(), 0.0008); near(realism.roundTripCostPct(), 0.16);
});
t('cost environment override', () => {
  process.env.REALISM_FEE_PCT = '0.10';
  near(realism.feePctPerSide(), 0.10); near(realism.roundTripCostPct(), 0.24);
  delete process.env.REALISM_FEE_PCT;
  near(realism.roundTripCostPct(), 0.16);
});

// ---- exchange minimum order (temporary limits file)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'limits-'));
const limFile = path.join(tmp, 'limits.json');
fs.writeFileSync(limFile, JSON.stringify({ exchange: 'bitget', fetchedAt: new Date().toISOString(), markets: {
  'BTC/USDT': { minCostUsd: 1, minAmount: 0.000001, lastPrice: 60000 },
  'ETH/USDT': { minCostUsd: 1, minAmount: 0.0005, lastPrice: 3000 },
  'XYZ/USDT': { minCostUsd: null, minAmount: null, lastPrice: null },
} }));
process.env.EXCHANGE_LIMITS_PATH = limFile;
t('min order = exchange minimum cost + 5% buffer (not a hand-set number)', () => {
  const m = realism.minOrderUsd('BTC/USDT');
  near(m.minUsd, 1.05); assert.ok(/bitget-market-info/.test(m.source));
});
t('min order uses amount minimum x price when that is larger', () => {
  near(realism.minOrderUsd('ETH/USDT').minUsd, 1.5 * 1.05);
  near(realism.minOrderUsd('ETH/USDT', 6000).minUsd, 3.0 * 1.05); // caller-supplied live price wins
});
t('min order: bare symbol is read as /USDT', () => near(realism.minOrderUsd('btc').minUsd, 1.05));
t('min order: unknown pair -> null (caller must not guess)', () => assert.strictEqual(realism.minOrderUsd('NOPE/USDT').minUsd, null));
t('min order: missing cache -> null', () => {
  process.env.EXCHANGE_LIMITS_PATH = path.join(tmp, 'does-not-exist.json');
  assert.strictEqual(realism.minOrderUsd('BTC/USDT').minUsd, null);
  process.env.EXCHANGE_LIMITS_PATH = limFile;
});

// ---- data-quality gate
const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const good = () => Array.from({ length: 100 }, (_, i) => {
  const ts = NOW - (100 - i) * 3600000 + 60000; const c = 100 + Math.sin(i / 5) * 3 + i * 0.01;
  return [ts, c - 0.2, c + 0.8, c - 0.9, c, 1000 + i];
});
const check = (over = {}) => realism.dataQualityCheck({ candles: good(), timeframeMs: 3600000, nowMs: NOW,
  indicators: { rsi14: 55, atr14: 1.5 }, price: 103, sources: { candles: 'bitget', ticker: 'live' }, ...over });
t('quality gate: good data passes', () => { const r = check(); assert.ok(r.ok, r.reasons.join('; ')); });
t('quality gate: synthetic candles fail', () => assert.ok(!check({ sources: { candles: 'synthetic', ticker: 'live' } }).ok));
t('quality gate: missing candles fail', () => assert.ok(!check({ candles: [], sources: { candles: 'none', ticker: 'live' } }).ok));
t('quality gate: seed price fails', () => assert.ok(!check({ sources: { candles: 'bitget', ticker: 'seed' } }).ok));
t('quality gate: too few candles fail', () => assert.ok(!check({ candles: good().slice(-20) }).ok));
t('quality gate: stale candles fail', () => assert.ok(!check({ nowMs: NOW + 6 * 3600000 }).ok));
t('quality gate: flat price series fails', () => assert.ok(!check({ candles: good().map((c) => [c[0], 100, 100, 100, 100, 5]) }).ok));
t('quality gate: zero volume fails', () => assert.ok(!check({ candles: good().map((c) => [c[0], c[1], c[2], c[3], c[4], 0]) }).ok));
t('quality gate: RSI pegged at 100 fails', () => assert.ok(!check({ indicators: { rsi14: 100, atr14: 1.5 } }).ok));
t('quality gate: RSI pegged at 0 fails', () => assert.ok(!check({ indicators: { rsi14: 0, atr14: 1.5 } }).ok));
t('quality gate: ATR zero fails', () => assert.ok(!check({ indicators: { rsi14: 55, atr14: 0 } }).ok));
t('quality gate: ticker far from candles fails', () => assert.ok(!check({ tickerLast: 140 }).ok));
t('quality gate: ticker close to candles passes', () => assert.ok(check({ tickerLast: 103.2 }).ok));

// ---- promotion bar
const ok = { oosTrades: 60, profitFactor: 1.31, oosProfitFactor: 1.31, maxDrawdownPct: 19.9, feesIncluded: true };
t('promotion bar: meets all four -> passes', () => assert.ok(realism.promotionCheck(ok).passed));
t('promotion bar: 59 OOS trades fails', () => assert.ok(!realism.promotionCheck({ ...ok, oosTrades: 59 }).passed));
t('promotion bar: PF exactly 1.3 fails (must be above)', () => assert.ok(!realism.promotionCheck({ ...ok, profitFactor: 1.3 }).passed));
t('promotion bar: drawdown exactly 20 fails (must be under)', () => assert.ok(!realism.promotionCheck({ ...ok, maxDrawdownPct: 20 }).passed));
t('promotion bar: fees not confirmed fails', () => assert.ok(!realism.promotionCheck({ ...ok, feesIncluded: false }).passed));
t('promotion bar: unknown values fail closed', () => assert.ok(!realism.promotionCheck({}).passed));
t('promotion bar numbers', () => { const b = realism.promotionBar(); assert.strictEqual(b.minOosTrades, 60); assert.strictEqual(b.liveGateMinTrades, 250); near(b.liveGateWinRate, 0.68); });

// ---- pnlStats
t('pnlStats: profit factor and drawdown', () => {
  const s = realism.pnlStats([10, -5, 10, -5, 10], 100);
  near(s.profitFactor, 3); near(s.grossWin, 30); near(s.grossLoss, 10);
  const d = realism.pnlStats([-30, 10], 100); near(d.maxDrawdownPct, 30);
});

// ---- flash-loan observation lock
t('flash-loan lock: observation-only by default', () => {
  delete process.env.ARB_MODE;
  assert.strictEqual(realism.arbitrageMode(), 'observe'); assert.strictEqual(realism.liveArbAllowed(), false);
});
t('flash-loan lock: ARB_MODE=live alone is not enough (no passing fork-test marker)', () => {
  process.env.ARB_MODE = 'live';
  assert.strictEqual(realism.liveArbAllowed(), realism.forkTestPassed());
  delete process.env.ARB_MODE;
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${pass} passed`);
