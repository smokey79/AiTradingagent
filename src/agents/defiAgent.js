/**
 * DeFi Agent - DexScreener Automated Intelligence
 * Deterministic rules-engine designed strictly for "High Probability of Success" trades.
 * Analyzes on-chain liquidity, volume, and momentum across top chains.
 */
const axios = require('axios');
const logger = require('../utils/logger');

// Cache settings to prevent rate-limiting on subsequent loops
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL

// Throttling state to serialize parallel requests in the cycle
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 300; // Ensure 300ms spacing between DexScreener hits

async function throttleRequest() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    const delay = MIN_REQUEST_INTERVAL_MS - elapsed;
    lastRequestTime = now + delay;
    await new Promise(resolve => setTimeout(resolve, delay));
  } else {
    lastRequestTime = now;
  }
}

async function getSignal(symbol, marketData) {
  const cleanSymbol = symbol.split('/')[0].toUpperCase();
  const now = Date.now();

  // 1. Read from cache if active
  const cached = cache.get(cleanSymbol);
  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    return cached.result;
  }

  try {
    // 2. Apply throttling to prevent concurrent parallel spikes (429 prevention)
    await throttleRequest();

    const { data } = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${cleanSymbol}%20USDT`, { timeout: 6000 });
    const supportedChains = ['ethereum', 'arbitrum', 'optimism', 'solana', 'avalanche', 'base', 'cronos', 'bsc', 'polygon'];
    const pairs = (data?.pairs || []).filter(p => 
      p.priceUsd && parseFloat(p.priceUsd) > 0 &&
      supportedChains.includes(p.chainId)
    );

    let result;

    if (pairs.length === 0) {
      // Check cached DeFi opportunity scanner for match
      try {
        const { getCachedDeFiOpportunities } = require('../data/dexScreenerDeFiScanner');
        const cachedDeFi = getCachedDeFiOpportunities();
        const match = cachedDeFi.find(c => c.symbol === cleanSymbol);
        if (match && match.signal === 'BUY') {
          result = {
            signal: 'BUY',
            confidence: match.confidence,
            weight: 1.5,
            reason: `[HEALTHY] DeFi DexScreener Scanner: Verified Breakout on ${match.chain} (${match.dexId}) | Quality: ${match.qualityScore}/100 | Liq: $${(match.liquidityUsd/1e6).toFixed(2)}M | Vol: $${(match.volume24hUsd/1e6).toFixed(2)}M | Chg: +${match.change24h}%`,
            rawResponse: match,
          };
        } else {
          result = { signal: 'HOLD', confidence: 0.70, weight: 1.0, reason: '[HEALTHY] No valid DEX liquidity found on supported chains', rawResponse: 'No pairs' };
        }
      } catch (_) {
        result = { signal: 'HOLD', confidence: 0.70, weight: 1.0, reason: '[HEALTHY] No valid DEX liquidity found on supported chains', rawResponse: 'No pairs' };
      }
    } else {
      // Find the pair with the most liquidity
      pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      const topPair = pairs[0];

      const liq = topPair.liquidity?.usd || 0;
      const vol = topPair.volume?.h24 || 0;
      const chg = topPair.priceChange?.h24 || 0;
      
      // Strict High Probability execution rules
      if (liq >= 500000 && vol >= 1000000 && chg >= 5 && chg <= 45) {
         result = {
           signal: 'BUY',
           confidence: 0.88,
           weight: 1.5,
           reason: `[HEALTHY] DeFi DexScreener: High Probability Breakout on ${topPair.chainId} (${topPair.dexId}) | Liq: $${(liq/1e6).toFixed(1)}M | Vol: $${(vol/1e6).toFixed(1)}M | Chg: +${chg}%`,
           rawResponse: topPair
         };
      } else if (liq >= 500000 && vol >= 1000000 && chg <= -5) {
         result = {
           signal: 'SELL',
           confidence: 0.88,
           weight: 1.5,
           reason: `[HEALTHY] DeFi DexScreener: High Probability Downtrend on ${topPair.chainId} (${topPair.dexId}) | Liq: $${(liq/1e6).toFixed(1)}M | Vol: $${(vol/1e6).toFixed(1)}M | Chg: ${chg}%`,
           rawResponse: topPair
         };
      } else {
        result = {
          signal: 'HOLD',
          confidence: 0.75,
          weight: 1.0,
          reason: `[HEALTHY] DeFi DexScreener: Metrics (Liq: $${(liq/1e6).toFixed(2)}M, Vol: $${(vol/1e6).toFixed(2)}M, Chg: ${chg}%) failed strict probability thresholds`,
          rawResponse: topPair
        };
      }
    }

    // Cache the successful outcome
    cache.set(cleanSymbol, { timestamp: now, result });
    return result;

  } catch (err) {
    logger.warn(`DeFi Agent API error: ${err.message}`);
    // Return a temporary hold but don't cache failures so we can retry on the next cycle
    return { signal: 'HOLD', confidence: 0, weight: 1.0, reason: `[ERROR] ${err.message}`, rawResponse: null };
  }
}

/**
 * Discovers and scans top DeFi breakout trade setups across all supported DEX chains.
 */
async function scanDeFiUniverse(options = {}) {
  const { scanDeFiOpportunities } = require('../data/dexScreenerDeFiScanner');
  return scanDeFiOpportunities(options);
}

module.exports = {
  getSignal,
  scanDeFiUniverse,
};
