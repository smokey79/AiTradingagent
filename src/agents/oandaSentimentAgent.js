/**
 * src/agents/oandaSentimentAgent.js
 * ===================================
 * OANDA retail Position Book sentiment agent. Added 2026-09-27 alongside
 * oandaBroker.js's getPositionBook() and the TradingView webhook agent, at
 * Alan's request to "utilize TradingView and OANDA's tools and features".
 *
 * What it reads: OANDA's free Position Book — the aggregated long/short
 * split of ALL retail traders on that instrument (not this account's own
 * positions). This is genuinely new data no other agent in this system
 * currently uses.
 *
 * How it votes: contrarian, and only on extreme skew. Retail positioning
 * data is widely used this way (heavily-crowded-long books have historically
 * preceded more reversals than continuations, and vice versa) but it is a
 * soft, probabilistic tell, not a strategy on its own — hence a low
 * AGENT_WEIGHTS entry (0.05, see consensus.js) and a strict >=65/35 skew
 * threshold before it ever casts a directional vote. Anything less lopsided
 * returns an honest HOLD, same discipline as volatilityRegimeAgent.js.
 *
 * Scope: OANDA-covered pairs only (forex/commodities/indices via
 * src/utils/instrumentUniverse.js). Crypto pairs always get a clean HOLD —
 * there is no OANDA position book for them.
 *
 * Caching: OANDA's own Position Book updates roughly every 20 minutes, so
 * this agent caches per-instrument for 20 minutes to avoid hammering the API
 * every trading cycle for data that hasn't changed.
 */
'use strict';

const logger = require('../utils/logger');
const { isOandaPair } = require('../utils/instrumentUniverse');

const CACHE_MS = 20 * 60 * 1000; // matches OANDA's own Position Book update cadence
const SKEW_THRESHOLD = 65; // percent — below this on both sides, stay HOLD
const _cache = new Map(); // instrument -> { data, fetchedAt }

async function getCachedPositionBook(symbol) {
  const now = Date.now();
  const hit = _cache.get(symbol);
  if (hit && now - hit.fetchedAt < CACHE_MS) return hit.data;

  const oandaBroker = require('../brokers/oandaBroker');
  const data = await oandaBroker.getPositionBook(symbol);
  _cache.set(symbol, { data, fetchedAt: now });
  return data;
}

async function getSignal(symbol, marketData, pair) {
  const pairLabel = pair || symbol;
  try {
    if (!isOandaPair(pairLabel)) {
      return {
        signal: 'HOLD',
        confidence: 0.5,
        reason: 'Not an OANDA-covered pair (crypto has no retail position book)',
        model_used: 'oanda-position-book',
        provider: 'oanda_sentiment',
      };
    }

    const book = await getCachedPositionBook(pairLabel);
    if (!book) {
      return {
        signal: 'HOLD',
        confidence: 0.4,
        reason: 'OANDA Position Book unavailable this cycle',
        model_used: 'oanda-position-book',
        provider: 'oanda_sentiment',
      };
    }

    const { longPercent, shortPercent } = book;
    if (longPercent >= SKEW_THRESHOLD) {
      return {
        signal: 'SELL',
        confidence: 0.55,
        reason: `Crowded retail long (${longPercent}% long / ${shortPercent}% short) — contrarian lean`,
        model_used: 'oanda-position-book',
        provider: 'oanda_sentiment',
        longPercent, shortPercent,
      };
    }
    if (shortPercent >= SKEW_THRESHOLD) {
      return {
        signal: 'BUY',
        confidence: 0.55,
        reason: `Crowded retail short (${shortPercent}% short / ${longPercent}% long) — contrarian lean`,
        model_used: 'oanda-position-book',
        provider: 'oanda_sentiment',
        longPercent, shortPercent,
      };
    }
    return {
      signal: 'HOLD',
      confidence: 0.4,
      reason: `Balanced retail positioning (${longPercent}% long / ${shortPercent}% short) — no edge`,
      model_used: 'oanda-position-book',
      provider: 'oanda_sentiment',
      longPercent, shortPercent,
    };
  } catch (err) {
    logger.warn(`[oandaSentimentAgent] ${pairLabel}: ${err.message}`);
    return {
      signal: 'HOLD',
      confidence: 0.3,
      reason: `OANDA sentiment check failed: ${err.message}`,
      model_used: 'oanda-position-book',
      provider: 'oanda_sentiment',
    };
  }
}

module.exports = { getSignal };
