// oanda_accounts_check_2026-09-30.js — READ-ONLY: list OANDA practice (sub-)accounts, balance, open trades, and whether
// crypto CFDs are tradeable on this account. Places no orders. Never prints the API token.
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const axios = require('axios');
const base = process.env.OANDA_ENV === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
const h = { Authorization: `Bearer ${process.env.OANDA_API_TOKEN}` };
(async () => {
  console.log('OANDA env:', process.env.OANDA_ENV);
  const { data } = await axios.get(`${base}/v3/accounts`, { headers: h, timeout: 15000 });
  const cfgId = process.env.OANDA_ACCOUNT_ID;
  for (const a of data.accounts) {
    const { data: s } = await axios.get(`${base}/v3/accounts/${a.id}/summary`, { headers: h, timeout: 15000 });
    const x = s.account;
    console.log(`${a.id === cfgId ? '* ' : '  '}${a.id.replace(/^(\d{3}-\d{3}-)\d+(-\d+)$/, '$1…$2')} ${x.alias || ''} | ${x.currency} balance ${x.balance} | NAV ${x.NAV} | open trades ${x.openTradeCount} | margin rate ${x.marginRate} (max ~${Math.round(1 / x.marginRate)}x)`);
  }
  const { data: ins } = await axios.get(`${base}/v3/accounts/${cfgId}/instruments`, { headers: h, timeout: 20000 });
  const types = {}; for (const i of ins.instruments) types[i.type] = (types[i.type] || 0) + 1;
  const crypto = ins.instruments.filter(i => /BTC|ETH|LTC|BCH/.test(i.name)).map(i => i.name);
  console.log('tradeable instruments on configured account:', ins.instruments.length, JSON.stringify(types));
  console.log('crypto CFDs available:', crypto.length ? crypto.join(',') : 'none (OANDA UK does not offer crypto CFDs to retail)');
})().catch(e => console.log('FAIL', e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 160)));
