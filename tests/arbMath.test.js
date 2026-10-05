// tests/arbMath.test.js — run: node tests\arbMath.test.js
const assert = require('assert');
const { optimalArb, findSameChainOpps } = require('../src/arbitrage/arbMath');
let pass = 0;
function t(name, fn) { try { fn(); pass++; console.log('PASS', name); } catch (e) { console.log('FAIL', name, '-', e.message); process.exitCode = 1; } }
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

// The exact trade the old engine booked as a $87.74 WIN: 1.33% spread, $7,220 size, $50k pools.
t('old XRP "win" is a loss once price impact is counted', () => {
  const k = 2 / 50000 + 2 / 50000;
  const size = 7220, g = 0.0133;
  const net = size * g - size * 0.006 - size * size * k - 7.5;
  assert.ok(net < 0, `expected a loss, got ${net}`);
});
t('spread below fees is not viable', () => assert.strictEqual(optimalArb({ buyPrice: 100, sellPrice: 100.5, buyLiqUsd: 1e7, sellLiqUsd: 1e7 }).viable, false));
t('optimal size formula', () => {
  const r = optimalArb({ buyPrice: 100, sellPrice: 101, buyLiqUsd: 1e6, sellLiqUsd: 1e6, swapFee: 0.003, maxSizeUsd: 1e9 });
  // edge = 0.01 - 0.006 = 0.004 ; k = 4e-6 ; S* = 0.004/8e-6 = 500 ; net = 0.004^2/(4*4e-6) = 1.0
  near(r.sizeUsd, 500, 1e-6); near(r.netUsd, 1.0, 1e-6);
});
t('size is capped', () => assert.ok(optimalArb({ buyPrice: 100, sellPrice: 110, buyLiqUsd: 1e9, sellLiqUsd: 1e9, maxSizeUsd: 1000 }).sizeUsd <= 1000));
t('gas can kill a small edge', () => assert.strictEqual(optimalArb({ buyPrice: 100, sellPrice: 101, buyLiqUsd: 1e6, sellLiqUsd: 1e6, gasUsd: 5 }).viable, false));
t('cross-chain pools are never paired', () => {
  const pools = [
    { chain: 'bsc', dex: 'pancake', pairAddress: 'a', tokenAddress: '0xT', symbol: 'X', priceUsd: 1.00, liqUsd: 1e8 },
    { chain: 'ethereum', dex: 'uni', pairAddress: 'b', tokenAddress: '0xT', symbol: 'X', priceUsd: 1.05, liqUsd: 1e8 },
  ];
  assert.strictEqual(findSameChainOpps(pools, { minNetUsd: 0 }).length, 0);
});
t('different token contracts are never paired', () => {
  const pools = [
    { chain: 'bsc', dex: 'p', pairAddress: 'a', tokenAddress: '0xA', symbol: 'X', priceUsd: 1.00, liqUsd: 1e8 },
    { chain: 'bsc', dex: 'q', pairAddress: 'b', tokenAddress: '0xB', symbol: 'X', priceUsd: 1.05, liqUsd: 1e8 },
  ];
  assert.strictEqual(findSameChainOpps(pools, { minNetUsd: 0 }).length, 0);
});
t('same chain, same token, deep pools, real spread is found', () => {
  const pools = [
    { chain: 'arbitrum', dex: 'uni', pairAddress: 'a', tokenAddress: '0xT', symbol: 'X', priceUsd: 100, liqUsd: 2e7 },
    { chain: 'arbitrum', dex: 'sushi', pairAddress: 'b', tokenAddress: '0xt', symbol: 'X', priceUsd: 101, liqUsd: 2e7 },
  ];
  const o = findSameChainOpps(pools, { gasByChain: { arbitrum: 0.03 }, minNetUsd: 3 });
  assert.strictEqual(o.length, 1); assert.strictEqual(o[0].buyDex, 'uni'); assert.ok(o[0].netUsd > 3);
});
console.log(`${pass} passed`);
