// duel_alpaca_check_2026-09-29.js — read-only: why does fetchAlpacaMarketData return nothing?
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { fetchAlpacaMarketData } = require('../src/data/alpacaMarketData');
const axios = require('axios');
(async () => {
  try { const d = await fetchAlpacaMarketData('SPY'); console.log('module result:', d ? `price ${d.price?.price}` : d); } catch (e) { console.log('module threw:', e.message); }
  const h = { 'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID, 'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY };
  try { const { data } = await axios.get('https://paper-api.alpaca.markets/v2/account', { headers: h, timeout: 15000 }); console.log('paper account:', data.status, 'equity', data.equity); }
  catch (e) { console.log('account FAIL', e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 150)); }
  try { const { data } = await axios.get('https://data.alpaca.markets/v2/stocks/SPY/trades/latest?feed=iex', { headers: h, timeout: 15000 }); console.log('data API SPY latest trade:', data.trade?.p, data.trade?.t); }
  catch (e) { console.log('data FAIL', e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 150)); }
  process.exit(0);
})();
