// duel_universe_probe_2026-09-29.js — read-only: which EXTRA markets do Bot A's own data modules return live prices for?
// Only markets that price successfully get added to the shared duel universe (so both bots can really trade them).
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const { fetchMarketData } = require('../src/data/marketData');
const { fetchOandaMarketData } = require('../src/data/oandaMarketData');
const cryptoCands = ['DOGE','SHIB','PEPE','WIF','BONK','FLOKI','TON','ADA','DOT','TIA','INJ','SEI','APT','RENDER','FET','ENA','WLD','JUP','ONDO','TAO','BCH','ETC','UNI','FIL','KAS','XLM','TRUMP'].map(s => `${s}/USDT`);
const oandaCands = ['EUR/GBP','EUR/JPY','GBP/JPY','USD/CAD','NZD/USD','AUD/JPY','EUR/CHF','XPT/USD','XCU/USD','JP225_USD','AU200_AUD','HK33_HKD','US30_USD','FR40_EUR','CORN_USD','WHEAT_USD','SUGAR_USD','SOYBN_USD','USB10Y_USD'];
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }
(async () => {
  const ok = { crypto: [], oanda: [] }, bad = [];
  await pool(cryptoCands, 4, async p => { const d = await fetchMarketData(p).catch(() => null); const px = d?.price?.price; (px > 0 && d?.indicators ? ok.crypto : bad).push(px > 0 ? p : `${p} (no price)`); });
  await pool(oandaCands, 3, async p => { const d = await fetchOandaMarketData(p).catch(() => null); const px = d?.price?.price; (px > 0 ? ok.oanda : bad).push(px > 0 ? p : `${p} (no price)`); });
  fs.writeFileSync(require('path').resolve(__dirname, '..', 'runs', '2026-09-29_duel', 'universe_probe.json'), JSON.stringify({ at: new Date().toISOString(), ok, bad }, null, 2));
  console.log('CRYPTO OK (' + ok.crypto.length + '):', ok.crypto.join(','));
  console.log('OANDA OK (' + ok.oanda.length + '):', ok.oanda.join(','));
  console.log('NOT AVAILABLE:', bad.join(', '));
  process.exit(0);
})();
