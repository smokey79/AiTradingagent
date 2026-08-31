/**
 * Cross-Chain Arbitrage Scanner Engine
 * Real-time monitoring across Ethereum, Arbitrum, Polygon, Base, Cronos, BSC, and Avalanche.
 */
const axios = require('axios');
const logger = require('../utils/logger');

const CHAINS = {
  ethereum:  { name: 'Ethereum',      gas: 2.50,  color: '#888780', native: 'ETH',  dex: 'Uniswap v3',    id: 1,     tier: 'high' },
  polygon:   { name: 'Polygon',       gas: 0.01,  color: '#7F77DD', native: 'MATIC',dex: 'QuickSwap',     id: 137,   tier: 'low' },
  cronos:    { name: 'Cronos',        gas: 0.002, color: '#378ADD', native: 'CRO',  dex: 'VVS Finance',   id: 25,    tier: 'ultra' },
  arbitrum:  { name: 'Arbitrum One',  gas: 0.03,  color: '#185FA5', native: 'ETH',  dex: 'Uniswap v3',    id: 42161, tier: 'low' },
  base:      { name: 'Base',          gas: 0.001, color: '#1D9E75', native: 'ETH',  dex: 'BaseSwap',      id: 8453,  tier: 'ultra' },
  bsc:       { name: 'BNB Chain',     gas: 0.10,  color: '#BA7517', native: 'BNB',  dex: 'PancakeSwap v3',id: 56,    tier: 'medium' },
  avalanche: { name: 'Avalanche',     gas: 0.05,  color: '#D85A30', native: 'AVAX', dex: 'Trader Joe',    id: 43114, tier: 'low' },
};

const SEED_ARB_PRICES = {
  ETH: {
    ethereum:  { price: 3521.00, liq: 5000000, vol: 20000000, dex: 'Uniswap v3',   ch24h: -1.3 },
    arbitrum:  { price: 3519.50, liq: 2000000, vol: 8000000,  dex: 'Uniswap v3',   ch24h: -1.2 },
    polygon:   { price: 3515.00, liq: 1500000, vol: 5000000,  dex: 'QuickSwap',    ch24h: -1.4 },
    base:      { price: 3522.00, liq: 800000,  vol: 2000000,  dex: 'BaseSwap',     ch24h: -1.1 },
    cronos:    { price: 3490.00, liq: 200000,  vol: 500000,   dex: 'VVS Finance',  ch24h: -2.1 },
    bsc:       { price: 3518.00, liq: 1000000, vol: 3000000,  dex: 'PancakeSwap',  ch24h: -1.3 },
    avalanche: { price: 3512.00, liq: 600000,  vol: 1500000,  dex: 'Trader Joe',   ch24h: -1.5 },
  },
  WBTC: {
    ethereum:  { price: 68450.00, liq: 8000000, vol: 30000000, dex: 'Uniswap v3',  ch24h: 0.8 },
    arbitrum:  { price: 68410.00, liq: 3000000, vol: 12000000, dex: 'Uniswap v3',  ch24h: 0.7 },
    polygon:   { price: 68320.00, liq: 1200000, vol: 4000000,  dex: 'QuickSwap',   ch24h: 0.6 },
    base:      { price: 68470.00, liq: 500000,  vol: 1500000,  dex: 'BaseSwap',    ch24h: 0.9 },
  },
  LINK: {
    ethereum:  { price: 14.92, liq: 2000000, vol: 8000000, dex: 'Uniswap v3',  ch24h: 2.1 },
    arbitrum:  { price: 14.88, liq: 900000,  vol: 3500000, dex: 'Uniswap v3',  ch24h: 1.9 },
    cronos:    { price: 14.62, liq: 80000,   vol: 200000,  dex: 'VVS Finance', ch24h: 1.2 },
    bsc:       { price: 14.85, liq: 600000,  vol: 2000000, dex: 'PancakeSwap', ch24h: 1.8 },
  },
  AAVE: {
    ethereum:  { price: 182.40, liq: 1500000, vol: 5000000, dex: 'Uniswap v3', ch24h: 3.2 },
    polygon:   { price: 181.90, liq: 700000,  vol: 2000000, dex: 'QuickSwap',  ch24h: 3.0 },
    arbitrum:  { price: 182.10, liq: 900000,  vol: 3000000, dex: 'Uniswap v3', ch24h: 3.1 },
  },
  CRO: {
    cronos:    { price: 0.1245, liq: 2500000, vol: 4500000, dex: 'VVS Finance', ch24h: 1.8 },
    ethereum:  { price: 0.1262, liq: 800000,  vol: 1200000, dex: 'Uniswap v3',  ch24h: 2.2 },
    polygon:   { price: 0.1250, liq: 400000,  vol: 600000,  dex: 'QuickSwap',   ch24h: 1.9 },
  },
};

function detectArbitrageOpportunities(prices = SEED_ARB_PRICES, tradeAmountUsd = 1000) {
  const opps = [];
  const now = new Date().toISOString();

  for (const [token, chainPrices] of Object.entries(prices)) {
    const chainKeys = Object.keys(chainPrices);

    for (const buyChain of chainKeys) {
      for (const sellChain of chainKeys) {
        if (buyChain === sellChain) continue;

        const bp = chainPrices[buyChain]?.price ?? chainPrices[buyChain]?.priceUsd ?? 0;
        const sp = chainPrices[sellChain]?.price ?? chainPrices[sellChain]?.priceUsd ?? 0;

        if (bp <= 0 || sp <= 0) continue;

        const grossPct = ((sp - bp) / bp) * 100;
        if (grossPct <= 0) continue;

        const buyGas = CHAINS[buyChain]?.gas ?? 1.0;
        const sellGas = CHAINS[sellChain]?.gas ?? 1.0;
        const gasCostUsd = buyGas + sellGas;
        const gasPct = (gasCostUsd / tradeAmountUsd) * 100;
        const netPct = grossPct - gasPct;

        if (netPct < 0.25 || grossPct > 20.0) continue; // Skip sub-0.25% noise and >20% phantom token mismatches

        const buyLiq = chainPrices[buyChain]?.liq ?? chainPrices[buyChain]?.liquidityUsd ?? 0;
        const sellLiq = chainPrices[sellChain]?.liq ?? chainPrices[sellChain]?.liquidityUsd ?? 0;

        opps.push({
          token,
          buyChain,
          buyChainName: CHAINS[buyChain]?.name || buyChain,
          sellChain,
          sellChainName: CHAINS[sellChain]?.name || sellChain,
          buyPrice: parseFloat(bp.toFixed(4)),
          sellPrice: parseFloat(sp.toFixed(4)),
          buyDex: chainPrices[buyChain]?.dex || 'DEX',
          sellDex: chainPrices[sellChain]?.dex || 'DEX',
          buyLiq,
          sellLiq,
          minLiquidity: Math.min(buyLiq, sellLiq),
          grossPct: parseFloat(grossPct.toFixed(3)),
          gasCostUsd: parseFloat(gasCostUsd.toFixed(3)),
          gasPct: parseFloat(gasPct.toFixed(3)),
          netPct: parseFloat(netPct.toFixed(3)),
          netUsd: parseFloat(((netPct / 100) * tradeAmountUsd).toFixed(2)),
          timestamp: now,
          actionable: netPct >= 0.8,
        });
      }
    }
  }

  opps.sort((a, b) => b.netPct - a.netPct);
  return opps;
}

module.exports = {
  CHAINS,
  SEED_ARB_PRICES,
  detectArbitrageOpportunities,
};
