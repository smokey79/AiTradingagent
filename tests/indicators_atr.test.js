// tests/indicators_atr.test.js (2026-10-03) -- ATR must not collapse to 0 for sub-$1 coins. Run: node tests/indicators_atr.test.js
'use strict';
const assert = require('assert');
const { calculateATR, calculateAllIndicators } = require('../src/data/indicators');
const mk = (price, n = 60) => Array.from({ length: n }, (_, i) => { const c = price * (1 + Math.sin(i / 4) * 0.02); return [i * 3600000, c, c * 1.01, c * 0.99, c, 1000]; });
let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS', name); } catch (e) { console.log('FAIL', name, '-', e.message); process.exitCode = 1; } };

t('ATR of a $0.30 coin is not rounded to zero', () => {
  const c = mk(0.30), r = calculateAllIndicators(c);
  assert.ok(r.atr14 > 0.001 && r.atr14 < 0.05, `atr14 ${r.atr14}`);
});
t('ATR of a $80,000 coin is still sensible', () => {
  const r = calculateAllIndicators(mk(80000));
  assert.ok(r.atr14 > 100 && r.atr14 < 5000, `atr14 ${r.atr14}`);
});
t('ATR of a $0.0000012 token is not zero', () => {
  const r = calculateAllIndicators(mk(0.0000012));
  assert.ok(r.atr14 > 0, `atr14 ${r.atr14}`);
});
console.log(`${pass} passed`);
