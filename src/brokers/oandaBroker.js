/**
 * src/brokers/oandaBroker.js
 * ==========================
 * OANDA v20 REST connector for forex, commodities and indices (CFDs) in
 * config/instrument_universe.json. Added 2026-09-24 (Alan chose OANDA).
 *
 * Facts this is built on (developer.oanda.com, checked 2026-09-24):
 *  - Hosts: practice https://api-fxpractice.oanda.com, live https://api-fxtrade.oanda.com
 *  - Auth: "Authorization: Bearer <token>". Token from hub.oanda.com -> Tools -> API.
 *    Account ID looks like xxx-xxx-xxxxxxx-xxx. A practice token only works on the practice host.
 *  - Limits: 120 requests/s, 2 new connections/s. We stay far below (1 call per 250 ms).
 *  - Candles: /v3/instruments/{X}/candles (free with any account, practice included).
 *
 * Environment (.env, never hard-coded; set with scripts\Set-EnvValue.ps1):
 *   OANDA_ENV          practice (default) | live
 *   OANDA_API_TOKEN    required
 *   OANDA_ACCOUNT_ID   required for account / order calls
 *   OANDA_ALLOW_LIVE   must be "true" to send ANY live order
 *   LEVERAGE_CAP       default 5 (Alan's max). Total position value <= cap x NAV.
 *
 * Safety rules enforced here, on top of the risk gate:
 *  - every order must carry a stop loss (stopLossPrice), or it is refused;
 *  - total open position value after the order must stay <= LEVERAGE_CAP x NAV;
 *  - live orders need OANDA_ALLOW_LIVE=true AND the live-funds gate
 *    (68% win rate over the last 250 real trades, src/risk/tradeLedger.js).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const axios = require('axios');

const ENV = (process.env.OANDA_ENV || 'practice').toLowerCase() === 'live' ? 'live' : 'practice';
const BASE = ENV === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
const LEVERAGE_CAP = Math.min(5, parseFloat(process.env.LEVERAGE_CAP || '5')); // never above 5x
const GRAN = { '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30', '1h': 'H1', '2h': 'H2', '4h': 'H4',
  '6h': 'H6', '8h': 'H8', '12h': 'H12', '1d': 'D', '1w': 'W' };

// Universe symbol -> OANDA instrument. Availability per account is checked by scripts/oanda_check.js.
const SYMBOL_MAP = {
  'EUR/USD': 'EUR_USD', 'GBP/USD': 'GBP_USD', 'USD/JPY': 'USD_JPY', 'AUD/USD': 'AUD_USD', 'USD/CHF': 'USD_CHF',
  'XAU/USD': 'XAU_USD', 'XAG/USD': 'XAG_USD', WTI: 'WTICO_USD', BRENT: 'BCO_USD', NATGAS: 'NATGAS_USD',
  US500: 'SPX500_USD', US100: 'NAS100_USD', UK100: 'UK100_GBP', GER40: 'DE30_EUR',
};
const toInstrument = (s) => SYMBOL_MAP[s] || String(s).toUpperCase().replace('/', '_');

let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function token() {
  const t = process.env.OANDA_API_TOKEN || '';
  if (!t) throw new Error('OANDA_API_TOKEN missing from .env (set it with scripts\\Set-EnvValue.ps1)');
  return t;
}
function accountId() {
  const a = process.env.OANDA_ACCOUNT_ID || '';
  if (!a) throw new Error('OANDA_ACCOUNT_ID missing from .env');
  return a;
}

async function call(method, url, data, http = axios) {
  const wait = lastCall + 250 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await http.request({ method, url: BASE + url, data, timeout: 20000, validateStatus: () => true,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', 'Accept-Datetime-Format': 'UNIX' } });
  if (res.status === 429) throw new Error(`OANDA rate limit hit on ${url} - slow down`);
  if (res.status === 401) throw new Error(`OANDA rejected the token (401). Check OANDA_API_TOKEN and that OANDA_ENV=${ENV} matches the token (practice vs live).`);
  if (res.status === 403) throw new Error('OANDA refused access (403). Check OANDA_ACCOUNT_ID (format xxx-xxx-xxxxxxx-xxx).');
  if (res.status >= 400) throw new Error(`OANDA ${method} ${url} failed ${res.status}: ${JSON.stringify(res.data).slice(0, 200)}`);
  return res.data;
}

async function getAccountSummary(http) {
  return (await call('GET', `/v3/accounts/${accountId()}/summary`, undefined, http)).account;
}

/** Tradeable instruments on this account: [{name, type, displayPrecision, tradeUnitsPrecision, minimumTradeSize, marginRate}] */
async function getInstruments(names, http) {
  const q = names && names.length ? `?instruments=${names.map(toInstrument).join(',')}` : '';
  return (await call('GET', `/v3/accounts/${accountId()}/instruments${q}`, undefined, http)).instruments || [];
}

/** Completed mid-price candles in the lab's shape: {timestamp(ms), open, high, low, close, volume, source}. */
async function getCandles(symbol, tf = '1h', count = 500, http) {
  const g = GRAN[tf];
  if (!g) throw new Error(`Unsupported timeframe ${tf}`);
  const inst = toInstrument(symbol);
  const d = await call('GET', `/v3/instruments/${inst}/candles?granularity=${g}&count=${Math.min(count, 5000)}&price=M`, undefined, http);
  return (d.candles || []).filter((c) => c.complete).map((c) => ({
    timestamp: Math.round(parseFloat(c.time) * 1000), open: +c.mid.o, high: +c.mid.h, low: +c.mid.l, close: +c.mid.c,
    volume: c.volume, source: 'oanda',
  }));
}

/** Current bid/ask plus the factor that converts one unit of the quote currency into account currency. */
async function getPrice(symbol, http) {
  const inst = toInstrument(symbol);
  const d = await call('GET', `/v3/accounts/${accountId()}/pricing?instruments=${inst}&includeHomeConversions=true`, undefined, http);
  const p = (d.prices || [])[0];
  if (!p) throw new Error(`No price for ${inst}`);
  const bid = +p.bids[0].price, ask = +p.asks[0].price;
  const quote = inst.split('_').pop();
  const conv = (d.homeConversions || []).find((h) => h.currency === quote);
  return { instrument: inst, bid, ask, mid: (bid + ask) / 2, tradeable: p.tradeable !== false,
    quoteToHome: conv ? parseFloat(conv.positionValue) : null };
}

async function getOpenPositions(http) {
  return (await call('GET', `/v3/accounts/${accountId()}/openPositions`, undefined, http)).positions || [];
}

function liveGateStatus() {
  try {
    const { getPerformanceStats } = require('../risk/tradeLedger');
    return getPerformanceStats(250).liveGate || { passed: false };
  } catch (e) { return { passed: false, error: e.message }; }
}

/**
 * Market order with a mandatory stop loss. units > 0 buys, < 0 sells.
 * opts: { stopLossPrice (required), takeProfitPrice, dryRun }
 * Practice: allowed. Live: only with OANDA_ALLOW_LIVE=true AND the live gate passed.
 * Refused if the total position value after the order would exceed LEVERAGE_CAP x NAV.
 */
async function placeMarketOrder(symbol, units, opts = {}, http) {
  const { stopLossPrice, takeProfitPrice, dryRun = false } = opts;
  if (!symbol || !Number.isFinite(units) || units === 0) throw new Error('placeMarketOrder needs a symbol and non-zero units');
  if (!Number.isFinite(stopLossPrice) || stopLossPrice <= 0) throw new Error('Every OANDA order needs a stopLossPrice - refused.');
  if (ENV === 'live') {
    if (process.env.OANDA_ALLOW_LIVE !== 'true') throw new Error('Live OANDA orders are disabled (set OANDA_ALLOW_LIVE=true only after the live gate passes).');
    const gate = liveGateStatus();
    if (!gate.passed) throw new Error(`Live gate not passed (${gate.trades || 0}/${gate.requiredTrades || 250} trades, win rate ${gate.winRate ?? 'n/a'}). Order blocked.`);
  }
  const inst = toInstrument(symbol);
  const [spec] = await getInstruments([inst], http);
  if (!spec) throw new Error(`${inst} is not tradeable on this OANDA account`);
  const dp = spec.displayPrecision, up = spec.tradeUnitsPrecision || 0;
  const u = Number(units.toFixed(up));
  if (Math.abs(u) < parseFloat(spec.minimumTradeSize || '1')) throw new Error(`${u} units is below the ${inst} minimum of ${spec.minimumTradeSize}`);

  const px = await getPrice(inst, http);
  const entry = u > 0 ? px.ask : px.bid;
  if (u > 0 ? stopLossPrice >= entry : stopLossPrice <= entry) throw new Error(`Stop ${stopLossPrice} is on the wrong side of the entry ${entry}`);
  if (px.quoteToHome == null) throw new Error(`Could not convert ${inst} to account currency - order refused (leverage cannot be checked)`);
  const acct = await getAccountSummary(http);
  const nav = parseFloat(acct.NAV), current = Math.abs(parseFloat(acct.positionValue || '0'));
  const notional = Math.abs(u) * entry * px.quoteToHome;
  if (current + notional > LEVERAGE_CAP * nav) {
    throw new Error(`Leverage cap: position value would be ${(current + notional).toFixed(2)} vs ${LEVERAGE_CAP}x NAV ${(LEVERAGE_CAP * nav).toFixed(2)} ${acct.currency}. Order refused.`);
  }

  const order = { type: 'MARKET', instrument: inst, units: String(u), timeInForce: 'FOK', positionFill: 'DEFAULT',
    stopLossOnFill: { price: stopLossPrice.toFixed(dp) } };
  if (Number.isFinite(takeProfitPrice)) order.takeProfitOnFill = { price: takeProfitPrice.toFixed(dp) };
  const check = { env: ENV, notionalHome: +notional.toFixed(2), leverageAfter: +((current + notional) / nav).toFixed(2), currency: acct.currency };
  if (dryRun) return { dryRun: true, ...check, body: { order } };
  const res = await call('POST', `/v3/accounts/${accountId()}/orders`, { order }, http);
  if (res.orderCancelTransaction) throw new Error(`OANDA cancelled the order: ${res.orderCancelTransaction.reason}`);
  return { ...check, fill: res.orderFillTransaction || null, raw: res };
}

module.exports = { ENV, BASE, LEVERAGE_CAP, SYMBOL_MAP, toInstrument, getAccountSummary, getInstruments, getCandles,
  getPrice, getOpenPositions, placeMarketOrder, liveGateStatus };
