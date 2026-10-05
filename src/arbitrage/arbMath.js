/**
 * arbMath.js — 2026-09-29
 * Pure maths for flash-loan arbitrage. No network, no side effects, so it
 * can be unit-tested (tests/arbMath.test.js).
 *
 * WHY THIS EXISTS: the old engine booked "zero-capital flash loan" wins on
 * CROSS-CHAIN routes (e.g. buy on BSC, sell on Ethereum). A flash loan must
 * be borrowed AND repaid inside ONE transaction on ONE chain, so a
 * cross-chain flash loan cannot exist. It also ignored price impact: a
 * $7,200 swap through a $50k pool moves the price by ~29%, not 0.1%.
 *
 * Model (constant-product AMM, conservative for concentrated-liquidity v3):
 *   Spending S dollars into a pool whose one side holds L/2 dollars moves
 *   the average fill price by ~S/(L/2) = 2S/L. Same on the sell side.
 *   profit(S) = S*(g - fees) - S^2*k - gas,   k = 2/Lbuy + 2/Lsell
 *   best size  S* = (g - fees) / (2k)
 *   best profit    = (g - fees)^2 / (4k) - gas
 * where g is the gross spread as a fraction and fees = 2 swap fees + the
 * flash-loan fee. Everything is expressed in USD and fractions (not %).
 */
'use strict';

function optimalArb({ buyPrice, sellPrice, buyLiqUsd, sellLiqUsd, swapFee = 0.003, flashFee = 0, gasUsd = 0, maxSizeUsd = 50000 }) {
  if (!(buyPrice > 0 && sellPrice > buyPrice && buyLiqUsd > 0 && sellLiqUsd > 0)) {
    return { viable: false, reason: 'no positive spread or missing liquidity' };
  }
  const g = (sellPrice - buyPrice) / buyPrice;
  const edge = g - 2 * swapFee - flashFee;          // spread left after fees, per $1 traded
  if (edge <= 0) return { viable: false, grossPct: g * 100, reason: 'spread smaller than swap + flash-loan fees' };
  const k = 2 / buyLiqUsd + 2 / sellLiqUsd;          // price-impact coefficient
  let size = edge / (2 * k);
  if (size > maxSizeUsd) size = maxSizeUsd;
  const impactUsd = size * size * k;
  const feesUsd = size * (2 * swapFee + flashFee);
  const grossUsd = size * g;
  const netUsd = grossUsd - feesUsd - impactUsd - gasUsd;
  return {
    viable: netUsd > 0,
    grossPct: g * 100,
    sizeUsd: size,
    grossUsd, feesUsd, impactUsd, gasUsd,
    netUsd,
    netPct: size > 0 ? (netUsd / size) * 100 : 0,
    reason: netUsd > 0 ? 'ok' : 'price impact + gas eat the spread',
  };
}

/**
 * findSameChainOpps(pools, opts)
 *   pools: [{ chain, dex, pairAddress, tokenAddress, symbol, priceUsd, liqUsd }]
 * Only pairs the SAME token contract (tokenAddress) on the SAME chain across
 * DIFFERENT pools — the only shape a flash loan can actually execute.
 */
function findSameChainOpps(pools, { swapFee = 0.003, flashFee = 0, gasByChain = {}, maxSizeUsd = 50000, minNetUsd = 3 } = {}) {
  const groups = new Map();
  for (const p of pools) {
    if (!p || !(p.priceUsd > 0) || !(p.liqUsd > 0) || !p.tokenAddress) continue;
    const key = `${p.chain}|${String(p.tokenAddress).toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const opps = [];
  for (const list of groups.values()) {
    for (const buy of list) {
      for (const sell of list) {
        if (buy === sell || buy.pairAddress === sell.pairAddress) continue;
        // flash loan + 2 swaps ~ 3 contract calls on this chain
        const gasUsd = (gasByChain[buy.chain] ?? 1.0) * 3;
        const r = optimalArb({ buyPrice: buy.priceUsd, sellPrice: sell.priceUsd, buyLiqUsd: buy.liqUsd, sellLiqUsd: sell.liqUsd, swapFee, flashFee, gasUsd, maxSizeUsd });
        if (!r.viable || r.netUsd < minNetUsd) continue;
        opps.push({
          type: 'SAME_CHAIN_FLASH',
          token: buy.symbol, chain: buy.chain,
          buyDex: buy.dex, sellDex: sell.dex,
          buyPair: buy.pairAddress, sellPair: sell.pairAddress,
          buyPrice: buy.priceUsd, sellPrice: sell.priceUsd,
          buyLiqUsd: buy.liqUsd, sellLiqUsd: sell.liqUsd,
          ...r,
        });
      }
    }
  }
  return opps.sort((a, b) => b.netUsd - a.netUsd);
}

module.exports = { optimalArb, findSameChainOpps };
