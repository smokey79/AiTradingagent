/**
 * src/brokers/alpacaBroker.js
 * ===========================
 * Alpaca Trading API connector for US equities and crypto. Added 2026-09-26.
 *
 * Facts this is built on (alpaca.markets/docs, checked 2026-09-26):
 *  - Hosts: paper https://paper-api.alpaca.markets, live https://api.alpaca.markets.
 *    These are genuinely separate accounts/hosts (unlike OANDA's one host, two
 *    env flag) - a paper key literally cannot authenticate against the live host.
 *  - Auth: "APCA-API-KEY-ID" + "APCA-API-SECRET-KEY" headers.
 *  - Market data: /v2/stocks/{symbol}/bars (stocks) and /v1beta3/crypto/us/bars
 *    (crypto), both free on a paper account.
 *  - Bracket orders (order_class: 'bracket') attach a stop-loss and
 *    take-profit to the entry order in one call - used here so every order
 *    carries a stop-loss the same way oandaBroker.js requires one.
 *
 * Environment (.env, never hard-coded; set with scripts\Set-EnvValue.ps1):
 *   ALPACA_ENV          paper (default) | live
 *   APCA_API_KEY_ID      required
 *   APCA_API_SECRET_KEY  required
 *   ALPACA_ALLOW_LIVE    must be "true" to send ANY live order
 *
 * Safety rules enforced here, on top of the risk gate:
 *  - every order must carry a stopLossPrice, or it is refused;
 *  - no margin/leverage is ever requested (plain cash-account sizing - this
 *    project's standing rule is 1x for crypto and a hard cap elsewhere, and
 *    Alpaca's margin rules are a separate regulatory regime this project
 *    hasn't been asked to model, so it is simply not used);
 *  - live orders need ALPACA_ALLOW_LIVE=true AND the live-funds gate
 *    (68% win rate over the last 250 real trades, src/risk/tradeLedger.js).
 *
 * NOT wired into the live trading cycle yet (unlike oandaBroker.js). Built
 * and tested standalone per Alan's request; wiring it in means picking which
 * venue owns the crypto-linked stock list (MSTR/COIN/... already trades
 * through Trading212 in config/instrument_universe.json) so the same names
 * aren't traded on two venues at once - see the session notes for the open
 * question.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const axios = require('axios');

const ENV = (process.env.ALPACA_ENV || 'paper').toLowerCase() === 'live' ? 'live' : 'paper';
const BASE = ENV === 'live' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
const DATA_BASE = 'https://data.alpaca.markets';

const TF = { '1m': '1Min', '5m': '5Min', '15m': '15Min', '30m': '30Min', '1h': '1Hour', '1d': '1Day' };

// Crypto symbols use Alpaca's own BASE/QUOTE format (e.g. BTC/USD); stock
// symbols are the ticker directly (e.g. AAPL, MSTR).
const isCryptoSymbol = (s) => String(s).includes('/');

let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function headers() {
  const key = process.env.APCA_API_KEY_ID || process.env.ALPACA_API_KEY || '';
  const secret = process.env.APCA_API_SECRET_KEY || process.env.ALPACA_SECRET_KEY || '';
  if (!key || !secret) throw new Error('APCA_API_KEY_ID / APCA_API_SECRET_KEY missing from .env (set with scripts\\Set-EnvValue.ps1)');
  return { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, 'Content-Type': 'application/json' };
}

async function call(method, url, data, http = axios) {
  const wait = lastCall + 350 - Date.now(); // Alpaca free tier: ~200 req/min - stay well under
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await http.request({ method, url, data, timeout: 20000, validateStatus: () => true, headers: headers() });
  if (res.status === 429) throw new Error(`Alpaca rate limit hit on ${url} - slow down`);
  if (res.status === 401 || res.status === 403) throw new Error(`Alpaca rejected the key (${res.status}). Check APCA_API_KEY_ID / APCA_API_SECRET_KEY and ALPACA_ENV=${ENV}.`);
  if (res.status >= 400) throw new Error(`Alpaca ${method} ${url} failed ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
  return res.data;
}

async function getAccount(http) {
  return call('GET', `${BASE}/v2/account`, undefined, http);
}

/** Tradeable check + fractionability + min order size for one symbol (stocks only). */
async function getAsset(symbol, http) {
  return call('GET', `${BASE}/v2/assets/${encodeURIComponent(symbol)}`, undefined, http);
}

/** Bars in the lab's shape: {timestamp(ms), open, high, low, close, volume, source}. */
async function getCandles(symbol, tf = '1h', count = 500, http) {
  const tfCode = TF[tf];
  if (!tfCode) throw new Error(`Unsupported timeframe ${tf}`);
  let data;
  if (isCryptoSymbol(symbol)) {
    data = await call('GET', `${DATA_BASE}/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(symbol)}&timeframe=${tfCode}&limit=${Math.min(count, 1000)}`, undefined, http);
    const bars = data.bars?.[symbol] || [];
    return bars.map((b) => ({ timestamp: Date.parse(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, source: 'alpaca' }));
  }
  data = await call('GET', `${DATA_BASE}/v2/stocks/${encodeURIComponent(symbol)}/bars?timeframe=${tfCode}&limit=${Math.min(count, 1000)}&adjustment=raw`, undefined, http);
  const bars = data.bars || [];
  return bars.map((b) => ({ timestamp: Date.parse(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v, source: 'alpaca' }));
}

/** Latest trade price. */
async function getPrice(symbol, http) {
  if (isCryptoSymbol(symbol)) {
    const d = await call('GET', `${DATA_BASE}/v1beta3/crypto/us/latest/trades?symbols=${encodeURIComponent(symbol)}`, undefined, http);
    const t = d.trades?.[symbol];
    if (!t) throw new Error(`No trade data for ${symbol}`);
    return { symbol, price: t.p, ts: t.t };
  }
  const d = await call('GET', `${DATA_BASE}/v2/stocks/${encodeURIComponent(symbol)}/trades/latest`, undefined, http);
  const t = d.trade;
  if (!t) throw new Error(`No trade data for ${symbol}`);
  return { symbol, price: t.p, ts: t.t };
}

async function getOpenPositions(http) {
  return call('GET', `${BASE}/v2/positions`, undefined, http);
}

function liveGateStatus() {
  try {
    const { getPerformanceStats } = require('../risk/tradeLedger');
    return getPerformanceStats(250).liveGate || { passed: false };
  } catch (e) { return { passed: false, error: e.message }; }
}

/**
 * Bracket market order with a mandatory stop loss. side: 'BUY' | 'SELL'.
 * opts: { stopLossPrice (required), takeProfitPrice, notionalUsd, qty, dryRun }
 * Paper: allowed. Live: only with ALPACA_ALLOW_LIVE=true AND the live gate passed.
 */
async function placeMarketOrder(symbol, side, opts = {}, http) {
  const { stopLossPrice, takeProfitPrice, notionalUsd, qty, dryRun = false } = opts;
  const normSide = String(side).toUpperCase() === 'SELL' ? 'sell' : 'buy';
  if (!symbol) throw new Error('placeMarketOrder needs a symbol');
  if (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0) throw new Error('Every Alpaca order needs a stopLossPrice - refused.');
  if (!notionalUsd && !qty) throw new Error('placeMarketOrder needs notionalUsd or qty');
  if (ENV === 'live') {
    if (process.env.ALPACA_ALLOW_LIVE !== 'true') throw new Error('Live Alpaca orders are disabled (set ALPACA_ALLOW_LIVE=true only after the live gate passes).');
    const gate = liveGateStatus();
    if (!gate.passed) throw new Error(`Live gate not passed (${gate.trades || 0}/${gate.requiredTrades || 250} trades, win rate ${gate.winRate ?? 'n/a'}). Order blocked.`);
  }

  const px = await getPrice(symbol, http);
  if (normSide === 'buy' ? stopLossPrice >= px.price : stopLossPrice <= px.price) {
    throw new Error(`Stop ${stopLossPrice} is on the wrong side of the current price ${px.price}`);
  }

  const order = {
    symbol,
    side: normSide,
    type: 'market',
    time_in_force: isCryptoSymbol(symbol) ? 'gtc' : 'day',
    order_class: 'bracket',
    stop_loss: { stop_price: stopLossPrice.toFixed(2) },
  };
  if (qty) order.qty = String(qty); else order.notional = String(notionalUsd);
  if (Number.isFinite(takeProfitPrice)) order.take_profit = { limit_price: takeProfitPrice.toFixed(2) };

  const check = { env: ENV, symbol, side: normSide, price: px.price };
  if (dryRun) return { dryRun: true, ...check, body: order };
  const res = await call('POST', `${BASE}/v2/orders`, order, http);
  return { ...check, order: res };
}

module.exports = { ENV, BASE, isCryptoSymbol, getAccount, getAsset, getCandles, getPrice, getOpenPositions, placeMarketOrder, liveGateStatus };
