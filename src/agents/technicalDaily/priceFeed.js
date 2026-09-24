/**
 * src/agents/technicalDaily/priceFeed.js
 * Free, no-key DAILY candles from Binance's public REST kline endpoint —
 * the same exchange/timeframe backtest_own_ohlcv.py used to validate
 * technicalConsensusAgent.js's settings. Deliberately self-contained
 * (same reasoning as technicalLab/priceFeed.js): the main project's
 * marketData.js builds 1h candles, and feeding a daily-bar strategy
 * hourly data would silently change every EMA/RSI/ATR value.
 *
 * CRO is intentionally NOT mapped here — technicalConsensusAgent.js
 * disables CRO outright (too little validated history), so there's no
 * need for the Bitget fallback backtest_own_ohlcv.py needed for CRO.
 */
'use strict';

const TOKEN_TO_BINANCE_SYMBOL = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', AVAX: 'AVAXUSDT',
  ARB: 'ARBUSDT', OP: 'OPUSDT',
  // added 2026-09-24 (OKB and FLR are not on Binance spot)
  LTC: 'LTCUSDT', TRX: 'TRXUSDT', ZEC: 'ZECUSDT', SUI: 'SUIUSDT', ICP: 'ICPUSDT',
  AAVE: 'AAVEUSDT', POL: 'POLUSDT', ATOM: 'ATOMUSDT',
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
 * Daily candles (Binance public kline). Binance returns oldest-first
 * ascending already, which is what technicalConsensusAgent.js expects.
 */
async function getDailyCandles(token, { limit = 300 } = {}) {
  const symbol = TOKEN_TO_BINANCE_SYMBOL[token];
  if (!symbol) throw new Error(`No Binance daily symbol mapped for ${token}`);
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=${limit}`;
  const res = await fetchWithRetry(url);
  const rows = await res.json(); // [openTime, open, high, low, close, volume, closeTime, ...], oldest-first
  return rows.map(([ts, open, high, low, close, volume]) => ({
    timestamp: Number(ts),
    open: Number(open), high: Number(high), low: Number(low), close: Number(close),
    volume: Number(volume),
  }));
}

module.exports = { getDailyCandles, TOKEN_TO_BINANCE_SYMBOL };
