
// tests/paperBook.test.js — run: node tests\paperBook.test.js
// 2026-10-03: costs are the shared realism settings (0.06% fee + 0.02% slippage = F per side), no longer 0.15%.
const assert = require('assert');
const B = require('../src/duel/paperBook');
const F = require('../src/utils/realism').costFractionPerSide(); // 0.0008
let pass = 0;
function t(name, fn) { try { fn(); pass++; console.log('PASS', name); } catch (e) { console.log('FAIL', name, '-', e.message); process.exitCode = 1; } }
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const O = (over = {}) => ({ key: 'crypto:BTC/USDT', market: 'crypto', side: 'LONG', notional: 100, leverage: 2, stopLossPct: 2, takeProfitPct: 4, ...over });

t('cost per side is 0.08% (0.06% fee + 0.02% slippage)', () => near(F, 0.0008, 1e-12));
t('open deducts margin + fee', () => { const b = B.newBook(250); const r = B.open(b, O(), 100); assert.ok(r.ok); near(b.cash, 250 - 50 - 100 * F); });
t('equity unchanged at entry except fee', () => { const b = B.newBook(250); B.open(b, O(), 100); near(B.equity(b, { 'crypto:BTC/USDT': 100 }), 250 - 100 * F); });
t('take profit closes with correct P&L', () => {
  const b = B.newBook(250); B.open(b, O(), 100); const c = B.mark(b, { 'crypto:BTC/USDT': 104 });
  assert.strictEqual(c[0].closeReason, 'TAKE_PROFIT'); near(c[0].netPnl, 4 - 2 * 100 * F); near(b.cash, 250 + 4 - 2 * 100 * F);
});
t('short stop loss', () => {
  const b = B.newBook(250); B.open(b, O({ side: 'SHORT' }), 100); const c = B.mark(b, { 'crypto:BTC/USDT': 102.5 });
  assert.strictEqual(c[0].closeReason, 'STOP_LOSS'); near(c[0].netPnl, -2.5 - 2 * 100 * F);
});
t('leverage capped per market', () => { const b = B.newBook(250); const r = B.open(b, O({ key: 'meme:x', market: 'meme', leverage: 5, notional: 20, stopLossPct: 10, takeProfitPct: 20 }), 1); assert.strictEqual(r.position.leverage, 1); });
t('meme short refused', () => assert.strictEqual(B.open(B.newBook(250), O({ key: 'meme:x', market: 'meme', side: 'SHORT' }), 1).ok, false));
t('5x leverage: $300 notional = $60 margin (24%) allowed', () => { const r = B.open(B.newBook(250), O({ notional: 300, leverage: 5 }), 100); assert.strictEqual(r.ok, true); near(r.position.margin, 60); });
t('5x leverage: $400 notional = $80 margin (32%) refused', () => assert.strictEqual(B.open(B.newBook(250), O({ notional: 400, leverage: 5 }), 100).ok, false));
t('margin 70 of 250 refused (28%)', () => assert.strictEqual(B.open(B.newBook(250), O({ notional: 140, leverage: 2 }), 100).ok, false));
t('duplicate instrument refused', () => { const b = B.newBook(250); B.open(b, O(), 100); assert.strictEqual(B.open(b, O(), 100).ok, false); });
t('loss capped at margin (liquidation)', () => {
  const b = B.newBook(250); B.open(b, O({ leverage: 5, notional: 250, stopLossPct: 15 }), 100);
  const c = B.mark(b, { 'crypto:BTC/USDT': 60 }); assert.strictEqual(c[0].closeReason, 'LIQUIDATED'); assert.ok(c[0].netPnl >= -50 - 250 * F - 1e-9);
});
t('floor closes everything and halts', () => {
  const b = B.newBook(32); assert.ok(B.open(b, O({ notional: 8, leverage: 1, stopLossPct: 20 }), 100).ok);
  const out = B.enforceFloor(b, { 'crypto:BTC/USDT': 50 }, 30);   // equity 32 - 4 loss ~ 27.99 <= 30
  assert.strictEqual(b.halted, true); assert.strictEqual(b.positions.length, 0); assert.strictEqual(out.length, 1);
  assert.strictEqual(B.open(b, O(), 100).ok, false);
});
t('no trading when halted', () => { const b = B.newBook(250); b.halted = true; assert.strictEqual(B.open(b, O(), 100).ok, false); });
console.log(`${pass} passed`);
