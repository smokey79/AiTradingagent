/**
 * src/agents/evidenceCandidates/priceFeed.js
 * Free, no-key candles. Tries Binance spot, then Bybit linear perps (the backtests
 * used Bybit perps), then OKX spot. CRO is not listed on Binance, so it uses Bybit/OKX.
 * Returns candles oldest-first: {timestamp, open, high, low, close, volume}.
 */
'use strict';
const BINANCE_TF = { '1h': '1h', '2h': '2h', '4h': '4h', '1d': '1d' };
const BYBIT_TF = { '1h': '60', '2h': '120', '4h': '240', '1d': 'D' };
const OKX_TF = { '1h': '1H', '2h': '2H', '4h': '4H', '1d': '1Dutc' };

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'aitradingagent/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split('?')[0]}`);
  return res.json();
}

const num = (x) => Number(x);

async function binance(coin, tf, limit) {
  const rows = await getJson(`https://api.binance.com/api/v3/klines?symbol=${coin}USDT&interval=${BINANCE_TF[tf]}&limit=${limit}`);
  return rows.map(([ts, o, h, l, c, v]) => ({ timestamp: num(ts), open: num(o), high: num(h), low: num(l), close: num(c), volume: num(v) }));
}
async function bybit(coin, tf, limit) {
  const j = await getJson(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${coin}USDT&interval=${BYBIT_TF[tf]}&limit=${Math.min(limit, 1000)}`);
  if (j.retCode !== 0) throw new Error(`Bybit ${j.retMsg}`);
  return j.result.list.map(([ts, o, h, l, c, v]) => ({ timestamp: num(ts), open: num(o), high: num(h), low: num(l), close: num(c), volume: num(v) })).reverse();
}
async function okx(coin, tf, limit) {
  const j = await getJson(`https://www.okx.com/api/v5/market/candles?instId=${coin}-USDT&bar=${OKX_TF[tf]}&limit=${Math.min(limit, 300)}`);
  if (j.code !== '0') throw new Error(`OKX ${j.msg}`);
  return j.data.map(([ts, o, h, l, c, v]) => ({ timestamp: num(ts), open: num(o), high: num(h), low: num(l), close: num(c), volume: num(v) })).reverse();
}

async function getCandles(coin, tf, { limit = 500 } = {}) {
  const errors = [];
  for (const [name, fn] of [['binance', binance], ['bybit', bybit], ['okx', okx]]) {
    try {
      const c = await fn(coin, tf, limit);
      if (c.length >= 150) return { candles: c, source: name };
      errors.push(`${name}: only ${c.length} candles`);
    } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
  throw new Error(`No candles for ${coin} ${tf} (${errors.join('; ')})`);
}

module.exports = { getCandles };
