/**
 * src/utils/exchangeLimits.js  (2026-10-03 calibration)
 *
 * Downloads the exchange's own market info (public endpoints, no API keys) and caches the minimum
 * order size per spot USDT pair in data/exchange_limits.json. src/utils/realism.js reads that cache
 * (minOrderUsd) so no minimum order size is ever hand-set.
 *
 *   node scripts/refresh_exchange_limits.js         one-off refresh
 *   startAutoRefresh()                               called by the orchestrator at start-up
 */
'use strict';

const fs = require('fs');
const path = require('path');
const realism = require('./realism');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, realism.CONFIG.min_order.cache_file);

async function refresh({ exchangeName } = {}) {
  const ccxt = require('ccxt');
  const name = exchangeName || realism.CONFIG.min_order.exchange;
  if (!ccxt[name]) throw new Error(`ccxt has no exchange called "${name}"`);
  const ex = new ccxt[name]({ enableRateLimit: true, timeout: 20000 });
  const markets = await ex.loadMarkets();
  let tickers = {};
  try { tickers = await ex.fetchTickers(); } catch (_) { /* last prices are optional */ }

  const out = {};
  for (const [sym, m] of Object.entries(markets)) {
    if (!m || !m.spot || m.active === false || m.quote !== 'USDT') continue;
    out[sym] = {
      minCostUsd: m.limits && m.limits.cost && m.limits.cost.min != null ? Number(m.limits.cost.min) : null,
      minAmount: m.limits && m.limits.amount && m.limits.amount.min != null ? Number(m.limits.amount.min) : null,
      lastPrice: tickers[sym] && tickers[sym].last ? Number(tickers[sym].last) : null,
    };
  }
  const payload = { exchange: name, fetchedAt: new Date().toISOString(), count: Object.keys(out).length, markets: out };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT + '.tmp', JSON.stringify(payload));
  fs.renameSync(OUT + '.tmp', OUT);
  return payload;
}

let timer = null;
function startAutoRefresh({ everyHours = 6, logger = console } = {}) {
  const run = () => refresh().then(
    (p) => logger.info ? logger.info(`[ExchangeLimits] cached ${p.count} ${p.exchange} spot pairs`) : null,
    (e) => logger.warn ? logger.warn(`[ExchangeLimits] refresh failed (${e.message}); keeping previous cache`) : null
  );
  run();
  if (timer) clearInterval(timer);
  timer = setInterval(run, everyHours * 3600 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = { refresh, startAutoRefresh, OUT };
