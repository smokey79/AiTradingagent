/**
 * src/data/mt5MarketData.js
 * Reads the JSON file scripts/mt5_market_feed.py writes on its own schedule
 * (data/mt5_market_data.json) and hands back one pair's price/candles in the
 * same shape oandaMarketData.js expects. Added 2026-09-26.
 *
 * This is a BACKUP data source only - see the big comment at the top of
 * mt5_market_feed.py for why MT5 isn't a second independent trading path
 * here (it's the same OANDA account/instruments the REST API already
 * trades). Read this file, never open a live MT5 connection from here -
 * that stays confined to the Python feed process so only one process holds
 * the terminal handle at a time.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const FEED_PATH = path.resolve(__dirname, '../../data/mt5_market_data.json');
const STALE_MS = 3 * 60 * 1000; // 3x the feed's own 30s-ish poll interval, generously

function readFeed() {
  try {
    const raw = fs.readFileSync(FEED_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null; // feed not running yet, or file mid-write - treat as unavailable
  }
}

/**
 * Returns { price: {mid,bid,ask}, candles: [...] } for `pair`, or null if the
 * MT5 feed has nothing usable for it (not running, stale, or symbol missing).
 */
function getMt5Fallback(pair) {
  const feed = readFeed();
  if (!feed) return null;

  const ageMs = Date.now() - new Date(feed.timestamp).getTime();
  if (Number.isNaN(ageMs) || ageMs > STALE_MS) {
    logger.warn(`[MT5 fallback] feed data for ${pair} is stale (${Math.round(ageMs / 1000)}s old) - ignoring.`);
    return null;
  }

  const entry = feed.symbols && feed.symbols[pair];
  if (!entry) return null;

  // Safety net (2026-09-26): the Python feed already skips writing a symbol
  // when its bid/ask come back as 0, but double-check here too - a stale
  // JSON edit or a future bug upstream should never let a 0.0 price get
  // treated as a real fallback price for a trade decision.
  if (!entry.mid || entry.mid <= 0 || !entry.bid || !entry.ask) {
    logger.warn(`[MT5 fallback] feed entry for ${pair} has an invalid price (mid=${entry.mid}) - ignoring.`);
    return null;
  }

  return {
    price: { mid: entry.mid, bid: entry.bid, ask: entry.ask },
    candles: entry.candles || [],
    mt5Symbol: entry.mt5Symbol,
    account: feed.account,
    mode: feed.mode,
  };
}

module.exports = { getMt5Fallback };
