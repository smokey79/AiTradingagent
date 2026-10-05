/**
 * src/arb/exchanges.js  (2026-10-03) -- live PUBLIC market data from several exchanges through ccxt. No API keys, no orders.
 * Env: ARB_EXCHANGES (comma list of ccxt ids), ARB_SYMBOLS (comma list of BASE/USDT).
 * Binance and Bybit are left out on purpose: they block UK addresses (public data fails). A venue that errors is skipped for that scan.
 */
'use strict';

// cryptocom is left out by default: its bulk-ticker call only accepts a handful of symbols per request. Add it back with ARB_EXCHANGES if you want it.
const DEFAULT_EXCHANGES = ['bitget', 'okx', 'kucoin', 'gate', 'mexc', 'kraken'];
const DEFAULT_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'LINK/USDT', 'AVAX/USDT', 'ARB/USDT', 'OP/USDT', 'XRP/USDT', 'DOGE/USDT', 'ADA/USDT'];

const exchangeNames = () => (process.env.ARB_EXCHANGES ? process.env.ARB_EXCHANGES.split(',') : DEFAULT_EXCHANGES).map((s) => s.trim()).filter(Boolean);
const symbolList = () => (process.env.ARB_SYMBOLS ? process.env.ARB_SYMBOLS.split(',') : DEFAULT_SYMBOLS).map((s) => s.trim()).filter(Boolean);

const clients = new Map();
const marketsLoaded = new Map();

function client(name) {
  if (!clients.has(name)) {
    const ccxt = require('ccxt');
    const C = ccxt[name];
    if (!C) return null;
    clients.set(name, new C({ enableRateLimit: true, timeout: 9000 }));
  }
  return clients.get(name);
}

async function ensureMarkets(name) {
  if (!marketsLoaded.has(name)) marketsLoaded.set(name, client(name).loadMarkets().then(() => true, () => false));
  return marketsLoaded.get(name);
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** { symbol: { bid, ask, taker } } for the symbols listed (spot, active) on this venue. */
async function fetchQuotes(name, symbols) {
  const ex = client(name);
  if (!ex || !(await ensureMarkets(name))) return {};
  const listed = symbols.filter((s) => ex.markets[s] && ex.markets[s].spot && ex.markets[s].active !== false);
  if (!listed.length) return {};
  const t = await withTimeout(ex.fetchTickers(listed), 12000);
  const out = {};
  for (const s of listed) {
    const q = t[s];
    if (q && q.bid > 0 && q.ask > 0 && q.bid < q.ask) out[s] = { bid: q.bid, ask: q.ask, taker: ex.markets[s].taker ?? ex.fees?.trading?.taker ?? 0.001 };
  }
  return out;
}

async function fetchBook(name, symbol, limit = 20) { // 20 is accepted by every venue in the list (KuCoin only allows 20 or 100)
  const ob = await withTimeout(client(name).fetchOrderBook(symbol, limit), 9000);
  return { asks: ob.asks || [], bids: ob.bids || [] };
}

async function fetchCloses(name, symbol, sinceMs, timeframe = '5m') {
  const ex = client(name);
  if (!ex || !(await ensureMarkets(name)) || !ex.markets[symbol]) return [];
  const rows = await withTimeout(ex.fetchOHLCV(symbol, timeframe, sinceMs, 300), 15000);
  return rows.map((r) => [r[0], r[4]]);
}

module.exports = { exchangeNames, symbolList, client, fetchQuotes, fetchBook, fetchCloses, DEFAULT_EXCHANGES, DEFAULT_SYMBOLS };
