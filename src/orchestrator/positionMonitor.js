'use strict';

// Exit monitoring shares the existing feeds and risk controller, without AI calls.
async function monitorOpenPositions() {
  const { getPortfolioState, resolveAllOpenPositions } = require('../risk/riskGate');
  const { isOandaPair, isAlpacaPair } = require('../utils/instrumentUniverse');
  const positions = getPortfolioState().openPositions || [];
  const prices = {};
  await Promise.allSettled(positions.map(async ({ pair }) => {
    const fetch = isOandaPair(pair)
      ? require('../data/oandaMarketData').fetchOandaMarketData
      : isAlpacaPair(pair)
        ? require('../data/alpacaMarketData').fetchAlpacaMarketData
        : require('../data/marketData').fetchMarketData;
    const snapshot = await fetch(pair);
    const price = snapshot?.price?.price;
    if (snapshot?.quality?.ok === false || !Number.isFinite(price) || price <= 0) return;
    prices[pair] = price;
  }));
  return resolveAllOpenPositions(prices);
}

module.exports = { monitorOpenPositions };
