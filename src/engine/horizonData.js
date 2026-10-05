'use strict';
const { prepare } = require('./features');
const cache = new Map();
let exchange;
const MINUTES = { '5m': 5, '1h': 60, '1d': 1440 };

function closedCandles(rows, timeframe, nowMs = Date.now()) {
  const step = MINUTES[timeframe] * 60000;
  if (!step) throw new Error('Unsupported candle timeframe');
  const seen = new Set();
  return (rows || []).filter(r => Array.isArray(r) && r.length >= 6 && r.slice(0, 6).every(Number.isFinite) &&
    r[0] + step <= nowMs && r[0] <= nowMs && r.slice(1, 5).every(x => x > 0) && r[5] >= 0 &&
    r[2] >= Math.max(r[1], r[4]) && r[3] <= Math.min(r[1], r[4]) && !seen.has(r[0]) && seen.add(r[0]))
    .sort((a, b) => a[0] - b[0]);
}

async function fetchHorizonCandles(pair, timeframes = ['5m', '1h', '1d']) {
  if (!exchange) exchange = new (require('ccxt').bitget)({ enableRateLimit: true, timeout: 10000 });
  const result = {};
  await Promise.allSettled(timeframes.map(async timeframe => {
    const key = `${pair}:${timeframe}`, ttl = MINUTES[timeframe] * 60000;
    const existing = cache.get(key);
    if (existing && Date.now() - existing.fetched < Math.min(ttl, 300000)) { result[timeframe] = existing.rows; return; }
    const rows = closedCandles(await exchange.fetchOHLCV(pair, timeframe, undefined, 300), timeframe);
    const last = rows.at(-1);
    if (!prepare(rows) || !last || Date.now() - last[0] > 2.5 * ttl) return;
    cache.set(key, { fetched: Date.now(), rows }); result[timeframe] = rows;
  }));
  return result;
}
module.exports = { fetchHorizonCandles, closedCandles, MINUTES };
