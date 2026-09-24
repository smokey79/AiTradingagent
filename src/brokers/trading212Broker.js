/**
 * src/brokers/trading212Broker.js
 * ================================
 * Trading 212 Public API connector (equities only: Invest / Stocks ISA accounts).
 * Used for crypto-linked stocks (MSTR, COIN, MARA ...) in config/instrument_universe.json.
 *
 * Facts this is built on (Trading 212 docs + community update, checked 2026-09-24):
 *  - The API works on Invest and Stocks ISA accounts only. CFD accounts are NOT supported,
 *    so leveraged CFDs cannot be placed from code. Shares are bought unleveraged.
 *  - Auth: API key + secret as HTTP Basic auth (older keys: key alone in Authorization header).
 *  - Live market orders are supported (beta since Oct 2025). Demo = practice account.
 *  - Strict per-endpoint rate limits (e.g. pending orders 1 request / 5 s). No price history
 *    endpoint: candles must come from another source (e.g. Alpha Vantage).
 *
 * Environment (.env, never hard-coded):
 *   T212_ENV          demo (default) | live
 *   T212_API_KEY      required
 *   T212_API_SECRET   recommended (new-style keys)
 *   T212_ALLOW_LIVE   must be "true" to send ANY live order
 *
 * Safety: live orders also require the live-funds gate in src/risk/tradeLedger.js
 * (68% win rate over the last 250 real trades). Demo orders are always allowed.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ENV = (process.env.T212_ENV || 'demo').toLowerCase() === 'live' ? 'live' : 'demo';
const BASE = ENV === 'live' ? 'https://live.trading212.com/api/v0' : 'https://demo.trading212.com/api/v0';
const INSTRUMENT_CACHE = path.resolve(__dirname, '../../data/t212_instruments.json');
const CACHE_MS = 24 * 60 * 60 * 1000;

// Minimum spacing between calls per endpoint (ms). Conservative versions of T212's published limits.
const MIN_GAP = { summary: 5000, instruments: 50000, portfolio: 5000, orders: 5000, order_market: 1200 };
const lastCall = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function authHeader() {
  const key = process.env.T212_API_KEY || '';
  const secret = process.env.T212_API_SECRET || '';
  if (!key) throw new Error('T212_API_KEY missing from .env');
  return secret ? 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64') : key;
}

async function call(bucket, method, url, data, http = axios) {
  const gap = MIN_GAP[bucket] || 1000;
  const wait = (lastCall[bucket] || 0) + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall[bucket] = Date.now();
  const res = await http.request({ method, url: BASE + url, data, timeout: 20000,
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' }, validateStatus: () => true });
  if (res.status === 429) throw new Error(`Trading 212 rate limit hit on ${url} - slow down`);
  if (res.status === 401 || res.status === 403) throw new Error(`Trading 212 rejected the API key (${res.status}). Check T212_API_KEY / T212_API_SECRET and T212_ENV=${ENV}.`);
  if (res.status >= 400) throw new Error(`Trading 212 ${method} ${url} failed ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
  return res.data;
}

async function getAccountSummary(http) {
  try { return await call('summary', 'GET', '/equity/account/summary', undefined, http); }
  catch (e) { if (/failed 404/.test(e.message)) return call('summary', 'GET', '/equity/account/cash', undefined, http); throw e; }
}

async function getInstruments({ refresh = false } = {}, http) {
  try {
    if (!refresh && fs.existsSync(INSTRUMENT_CACHE) && Date.now() - fs.statSync(INSTRUMENT_CACHE).mtimeMs < CACHE_MS) {
      return JSON.parse(fs.readFileSync(INSTRUMENT_CACHE, 'utf8'));
    }
  } catch { /* refetch */ }
  const list = await call('instruments', 'GET', '/equity/metadata/instruments', undefined, http);
  try { fs.writeFileSync(INSTRUMENT_CACHE, JSON.stringify(list)); } catch { /* cache is optional */ }
  return list;
}

/** Map a plain symbol (MSTR) to T212's ticker (e.g. MSTR_US_EQ). Returns null if not tradable on this account. */
async function findTicker(symbol, http) {
  const list = await getInstruments({}, http);
  const s = String(symbol).toUpperCase();
  const hits = list.filter((i) => (i.shortName || '').toUpperCase() === s || (i.ticker || '').toUpperCase().startsWith(s + '_'));
  const us = hits.find((i) => /_US_EQ$/.test(i.ticker || ''));
  const pick = us || hits[0];
  return pick ? { ticker: pick.ticker, name: pick.name, currency: pick.currencyCode, type: pick.type } : null;
}

async function getPositions(http) { return call('portfolio', 'GET', '/equity/portfolio', undefined, http); }
async function getPendingOrders(http) { return call('orders', 'GET', '/equity/orders', undefined, http); }

function liveGateStatus() {
  try {
    const { getPerformanceStats } = require('../risk/tradeLedger');
    return getPerformanceStats(250).liveGate || { passed: false };
  } catch (e) { return { passed: false, error: e.message }; }
}

/**
 * Market order. quantity > 0 buys, < 0 sells. Demo: always allowed.
 * Live: only if T212_ALLOW_LIVE=true AND the live-funds gate has passed.
 */
async function placeMarketOrder(ticker, quantity, { dryRun = false } = {}, http) {
  if (!ticker || !Number.isFinite(quantity) || quantity === 0) throw new Error('placeMarketOrder needs a ticker and a non-zero quantity');
  if (ENV === 'live') {
    if (process.env.T212_ALLOW_LIVE !== 'true') throw new Error('Live Trading 212 orders are disabled (set T212_ALLOW_LIVE=true only after the live gate passes).');
    const gate = liveGateStatus();
    if (!gate.passed) throw new Error(`Live gate not passed (${gate.trades || 0}/${gate.requiredTrades || 250} trades, win rate ${gate.winRate ?? 'n/a'}). Order blocked.`);
  }
  const body = { ticker, quantity: Number(quantity) };
  if (dryRun) return { dryRun: true, env: ENV, body };
  return call('order_market', 'POST', '/equity/orders/market', body, http);
}

module.exports = { ENV, BASE, getAccountSummary, getInstruments, findTicker, getPositions, getPendingOrders,
  placeMarketOrder, liveGateStatus, _authHeader: authHeader };
