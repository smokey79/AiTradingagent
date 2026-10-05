/**
 * src/data/alpacaMarketData.js
 * Builds a marketData object for an Alpaca-covered US stock in the SAME
 * shape src/data/marketData.js produces for crypto pairs, so it flows
 * through the existing consensus/riskGate/execution pipeline unmodified.
 * Added 2026-09-27 (Alan's explicit instruction — multi-market expansion,
 * modeled directly on src/data/oandaMarketData.js).
 */
const logger = require('../utils/logger');
const alpaca = require('../brokers/alpacaBroker');
const { calculateAllIndicators } = require('./indicators');

const CACHE_TTL_MS = 25 * 1000; // matches marketData.js's crypto cache window
const cache = {}; // keyed by symbol

async function fetchAlpacaMarketData(symbol) {
  const now = Date.now();
  if (cache[symbol] && now - cache[symbol].ts < CACHE_TTL_MS) {
    return cache[symbol].data;
  }

  const [candles, priceQuote] = await Promise.all([
    alpaca.getCandles(symbol, '1h', 100).catch((err) => {
      logger.warn(`[Alpaca] ${symbol} candle fetch failed: ${err.message}`);
      return [];
    }),
    alpaca.getPrice(symbol).catch((err) => {
      logger.warn(`[Alpaca] ${symbol} price fetch failed: ${err.message}`);
      return null;
    }),
  ]);

  // No US stock market equivalent of OANDA's MT5 fallback exists here — if
  // Alpaca has no price this cycle, the pair is simply skipped (same as
  // every other feed in this codebase when its primary source is down).
  if (!priceQuote) return null; // index.js already treats a null marketData entry as "unavailable"

  const currentPrice = priceQuote.price;
  const firstClose = candles.length > 0 ? candles[0].close : currentPrice;
  const change24h = firstClose > 0 ? ((currentPrice - firstClose) / firstClose) * 100 : 0;
  const closes = candles.map((c) => c.close);
  const high24h = closes.length ? Math.max(...closes, currentPrice) : currentPrice;
  const low24h = closes.length ? Math.min(...closes, currentPrice) : currentPrice;

  // calculateAllIndicators already handles both ccxt arrays and object
  // candles (see src/data/indicators.js) — Alpaca's {open,high,low,close,
  // volume} shape needs no conversion, same as OANDA's.
  const indicators = calculateAllIndicators(candles, null);

  const result = {
    symbol,
    pair: symbol,
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
      source: `alpaca_${alpaca.ENV}_api`,
    },
    indicators,
    // US equities have no crypto Fear & Greed index. Neutral 50 has the
    // same effect as omitting sentiment — it never pushes the consensus
    // vote either way (same convention as oandaMarketData.js).
    fearGreed: { value: 50, score: 50, classification: 'Neutral', previousValue: 50, trend: 'neutral' },
    dex: null,
    cmc: null,
    onchain: null,
    venue: 'alpaca',
    alpacaEnv: alpaca.ENV,
    timestamp: Date.now(),
  };

  cache[symbol] = { data: result, ts: now };
  return result;
}

module.exports = { fetchAlpacaMarketData };
