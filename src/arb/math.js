/**
 * src/arb/math.js  (2026-10-03) -- pure order-book maths for cross-exchange arbitrage. No network, no files.
 * Books are [[price, baseQty], ...], best price first. Buying walks the ASKS of venue A, selling walks the BIDS of venue B,
 * so the result already contains price impact. Costs deducted: taker fee on both legs, a latency haircut per leg (the
 * price moves while the two orders travel), and an amortised rebalancing cost (moving inventory back between venues).
 */
'use strict';

/** Spend `notionalUsd` walking the asks. */
function buyVwap(asks, notionalUsd) {
  let spent = 0, qty = 0;
  for (const [p, q] of asks) {
    const cost = p * q;
    if (spent + cost >= notionalUsd) { const rest = notionalUsd - spent; qty += rest / p; spent = notionalUsd; break; }
    spent += cost; qty += q;
  }
  return { qty, spent, avg: qty ? spent / qty : 0, filled: spent >= notionalUsd - 1e-9 };
}

/** Sell `qty` base units walking the bids. */
function sellVwap(bids, qty) {
  let left = qty, got = 0;
  for (const [p, q] of bids) {
    const take = Math.min(left, q);
    got += take * p; left -= take;
    if (left <= qty * 1e-9) { left = 0; break; }
  }
  const sold = qty - left;
  return { proceeds: got, soldQty: sold, avg: sold ? got / sold : 0, filled: left <= qty * 1e-9 };
}

const bookValueUsd = (levels) => levels.reduce((s, [p, q]) => s + p * q, 0);

/** Biggest order worth trying: never more than half the visible depth on either side, capped by maxNotionalUsd. */
function suggestNotional(asks, bids, maxNotionalUsd) {
  return Math.max(0, Math.min(maxNotionalUsd, bookValueUsd(asks) * 0.5, bookValueUsd(bids) * 0.5));
}

function netOpportunity({ asks, bids, notionalUsd, feeBuyPct, feeSellPct, latencyPctPerSide = 0.03, rebalancePct = 0.05 }) {
  if (!(notionalUsd > 0)) return { ok: false, reason: 'no depth' };
  const buy = buyVwap(asks, notionalUsd);
  if (!buy.filled) return { ok: false, reason: 'ask side too thin for this size' };
  const sell = sellVwap(bids, buy.qty);
  if (!sell.filled) return { ok: false, reason: 'bid side too thin for this size' };
  const grossUsd = sell.proceeds - buy.spent;
  const feesUsd = buy.spent * feeBuyPct / 100 + sell.proceeds * feeSellPct / 100;
  const latencyUsd = notionalUsd * latencyPctPerSide / 100 * 2;
  const rebalanceUsd = notionalUsd * rebalancePct / 100;
  const netUsd = grossUsd - feesUsd - latencyUsd - rebalanceUsd;
  return { ok: true, notionalUsd, qty: buy.qty, buyAvg: buy.avg, sellAvg: sell.avg, grossUsd, feesUsd, latencyUsd, rebalanceUsd, netUsd,
    grossPct: (grossUsd / buy.spent) * 100, netPct: (netUsd / buy.spent) * 100 };
}

module.exports = { buyVwap, sellVwap, bookValueUsd, suggestNotional, netOpportunity };
