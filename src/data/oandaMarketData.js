/**
 * src/data/oandaMarketData.js
 * Builds a marketData object for an OANDA-covered pair (forex, commodity or
 * index CFD) in the SAME shape src/data/marketData.js produces for crypto
 * pairs, so it flows through the existing consensus/riskGate/execution
 * pipeline unmodified. Added 2026-09-26 to wire OANDA into the live cycle.
 */
const logger = require('../utils/logger');
const oanda = require('../brokers/oandaBroker');
const { calculateAllIndicators } = require('./indicators');

const CACHE_TTL_MS = 25 * 1000; // matches marketData.js's crypto cache window
const cache = {}; // keyed by pair

async function fetchOandaMarketData(pair) {
  const now = Date.now();
  if (cache[pair] && now - cache[pair].ts < CACHE_TTL_MS) {
    return cache[pair].data;
  }

  const [candles, priceQuote] = await Promise.all([
    oanda.getCandles(pair, '1h', 100).catch((err) => {
      logger.warn(`[OANDA] ${pair} candle fetch failed: ${err.message}`);
      return [];
    }),
    oanda.getPrice(pair).catch((err) => {
      logger.warn(`[OANDA] ${pair} price fetch failed: ${err.message}`);
      return null;
    }),
  ]);

  if (!priceQuote) return null; // index.js already treats a null marketData entry as "unavailable"

  const currentPrice = priceQuote.mid;
  const firstClose = candles.length > 0 ? candles[0].close : currentPrice;
  const change24h = firstClose > 0 ? ((currentPrice - firstClose) / firstClose) * 100 : 0;
  const closes = candles.map((c) => c.close);
  const high24h = closes.length ? Math.max(...closes, currentPrice) : currentPrice;
  const low24h = closes.length ? Math.min(...closes, currentPrice) : currentPrice;

  // calculateAllIndicators accepts OANDA's {open,high,low,close,volume} candle
  // shape directly — src/data/indicators.js already handles both ccxt arrays
  // and object candles, so no conversion is needed here.
  const indicators = calculateAllIndicators(candles, null);

  const result = {
    symbol: pair.split('/')[0],
    pair,
    price: {
      price: currentPrice,
      change24h: parseFloat(change24h.toFixed(3)),
      change1h: 0.0,
      change7d: 0.0,
      volume24h: candles.reduce((s, c) => s + (c.volume || 0), 0),
      marketCap: 0,
      cmcRank: 0,
      high24h,
      low24h,
      source: `oanda_${oanda.ENV}_api`,
    },
    indicators,
    // Forex/commodities/indices have no crypto Fear & Greed index. Neutral 50
    // has the same effect as omitting sentiment for these instruments - it
    // never pushes the consensus vote either way.
    fearGreed: { value: 50, score: 50, classification: 'Neutral', previousValue: 50, trend: 'neutral' },
    dex: null,
    cmc: null,
    onchain: null,
    venue: 'oanda',
    oandaEnv: oanda.ENV,
    timestamp: Date.now(),
  };

  cache[pair] = { data: result, ts: now };
  return result;
}

module.exports = { fetchOandaMarketData };
