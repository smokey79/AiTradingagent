/**
 * src/agents/technicalMtf/priceFeed.js
 * Free, no-key candles from Binance's public REST kline endpoint, at
 * whichever interval (15m/1h/4h) the multi-timeframe research needs.
 *
 * Built for the 2026-09-23 "research 15m and larger timeframes against
 * the top 50 cryptos" request. Deliberately self-contained (same
 * reasoning as technicalDaily/priceFeed.js and technicalLab/priceFeed.js):
 * a strategy validated on one timeframe silently breaks if fed another,
 * so this agent fetches its OWN candles rather than reusing marketData's.
 *
 * Only the tokens that actually cleared the cross-cycle-robustness bar
 * in backtest_mtf.py are mapped here.
 */
'use strict';

const TOKEN_TO_BINANCE_SYMBOL = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', ZEC: 'ZECUSDT', ADA: 'ADAUSDT',
  NEAR: 'NEARUSDT', AVAX: 'AVAXUSDT', SUI: 'SUIUSDT', HBAR: 'HBARUSDT',
  TAO: 'TAOUSDT', ENA: 'ENAUSDT',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, { retries = 2, baseDelayMs = 3000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res;
    if (res.status === 429 && attempt < retries) {
      await sleep(baseDelayMs * (attempt + 1));
      continue;
    }
    lastErr = new Error(`HTTP ${res.status}`);
    break;
  }
  throw lastErr;
}

/**
 * Candles at the given Binance interval ('15m' | '1h' | '4h'). Binance
 * returns oldest-first ascending already, which is what the strategy
 * math below expects (same convention as technicalDaily/priceFeed.js).
 */
async function getCandles(token, interval, { limit = 300 } = {}) {
  const symbol = TOKEN_TO_BINANCE_SYMBOL[token];
  if (!symbol) throw new Error(`No Binance symbol mapped for ${token} in technicalMtf`);
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetchWithRetry(url);
  const rows = await res.json(); // [openTime, open, high, low, close, volume, closeTime, ...], oldest-first
  return rows.map(([ts, open, high, low, close, volume]) => ({
    timestamp: Number(ts),
    open: Number(open), high: Number(high), low: Number(low), close: Number(close),
    volume: Number(volume),
  }));
}

module.exports = { getCandles, TOKEN_TO_BINANCE_SYMBOL };
