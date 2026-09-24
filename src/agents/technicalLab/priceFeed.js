/**
 * src/agents/technicalLab/priceFeed.js
 * Free, no-key 2-hour candles from Bybit's public v5 kline endpoint — the
 * SAME exchange/timeframe the validated strategy in strategy.js was
 * researched and backtested on (F:\aitradingagent\research\
 * btc_strategy_lab_2026-09-13\FINAL_REPORT.md). Deliberately NOT reusing
 * the main project's src/data/marketData.js (Binance/Bitget 1h candles) —
 * a different exchange/timeframe can quietly change VWAP and EMA-cross
 * timing enough to invalidate the validated edge without any error being
 * thrown. Ported verbatim from F:\aitradingagent2\src\data\priceFeed.js.
 */
'use strict';

const TOKEN_TO_BYBIT_SYMBOL = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', AVAX: 'AVAXUSDT',
  ARB: 'ARBUSDT', OP: 'OPUSDT', CRO: 'CROUSDT',
  // added 2026-09-24
  LTC: 'LTCUSDT', TRX: 'TRXUSDT', ZEC: 'ZECUSDT', SUI: 'SUIUSDT', OKB: 'OKBUSDT',
  ICP: 'ICPUSDT', AAVE: 'AAVEUSDT', POL: 'POLUSDT', ATOM: 'ATOMUSDT', FLR: 'FLRUSDT',
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
 * 2-hour candles (Bybit public kline, category=linear USDT perpetual).
 * Bybit returns newest-first; reversed to ascending (oldest -> newest),
 * which every function in ./indicators.js expects.
 */
async function getIntradayCandles(token, { interval = '120', limit = 500 } = {}) {
  const symbol = TOKEN_TO_BYBIT_SYMBOL[token];
  if (!symbol) throw new Error(`No Bybit symbol mapped for ${token}`);
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetchWithRetry(url);
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(`Bybit kline error for ${token}: ${data.retMsg}`);
  const rows = data.result?.list || []; // [startTs, open, high, low, close, volume, turnover], newest-first, strings
  return rows
    .map(([ts, open, high, low, close, volume]) => ({
      timestamp: Number(ts),
      open: Number(open), high: Number(high), low: Number(low), close: Number(close),
      volume: Number(volume),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

module.exports = { getIntradayCandles, TOKEN_TO_BYBIT_SYMBOL };
