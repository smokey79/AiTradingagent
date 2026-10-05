// duel_add_all_oanda_2026-09-30.js — Alan: "use oanda" -> add ALL instruments his OANDA practice account can trade
// to the SHARED duel universe (config/instrument_universe.json), for both bots at once. Backs up the file first.
// Naming: currencies/metals as "EUR/USD" (same style as existing), CFDs as OANDA's own id (e.g. "JP225_USD");
// src/brokers/oandaBroker.js toInstrument() turns either form into the OANDA id. Existing aliases (WTI, US500, ...)
// are respected so nothing is added twice.
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs'), path = require('path'), axios = require('axios');
const root = path.resolve(__dirname, '..');
const base = process.env.OANDA_ENV === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
const ALIAS = { 'XAU/USD': 'XAU_USD', 'XAG/USD': 'XAG_USD', WTI: 'WTICO_USD', BRENT: 'BCO_USD', NATGAS: 'NATGAS_USD',
  US500: 'SPX500_USD', US100: 'NAS100_USD', UK100: 'UK100_GBP', GER40: 'DE30_EUR' };
const toId = s => ALIAS[s] || String(s).toUpperCase().replace('/', '_');
const INDEX_RE = /^(SPX500|NAS100|US30|US2000|UK100|DE30|DE40|FR40|EU50|JP225|AU200|HK33|CN50|IN50|NL25|CH20|ESPIX|SG30|TWIX|US500)/;
(async () => {
  const { data } = await axios.get(`${base}/v3/accounts/${process.env.OANDA_ACCOUNT_ID}/instruments`,
    { headers: { Authorization: `Bearer ${process.env.OANDA_API_TOKEN}` }, timeout: 20000 });
  const uPath = path.join(root, 'config/instrument_universe.json');
  fs.copyFileSync(uPath, `${uPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const u = JSON.parse(fs.readFileSync(uPath, 'utf8'));
  const have = new Set(['forex', 'commodities', 'indices'].flatMap(c => u.classes[c].symbols).map(toId));
  const added = { forex: 0, commodities: 0, indices: 0 };
  for (const ins of data.instruments) {
    if (have.has(ins.name)) continue;
    const slash = ins.name.replace('_', '/');
    if (ins.type === 'CURRENCY') { u.classes.forex.symbols.push(slash); added.forex++; }
    else if (ins.type === 'METAL') { u.classes.commodities.symbols.push(slash); added.commodities++; }
    else if (INDEX_RE.test(ins.name)) { u.classes.indices.symbols.push(ins.name); added.indices++; }
    else { u.classes.commodities.symbols.push(ins.name); added.commodities++; }   // energy, agri, bonds
    have.add(ins.name);
  }
  u.classes.forex.notes = (u.classes.forex.notes || '') + ` 2026-09-30: all ${data.instruments.length} instruments on the OANDA practice account added for the duel (Alan: "use oanda").`;
  fs.writeFileSync(uPath, JSON.stringify(u, null, 2));
  const tot = Object.fromEntries(['forex', 'commodities', 'indices'].map(c => [c, u.classes[c].symbols.length]));
  console.log('added:', JSON.stringify(added), '| totals:', JSON.stringify(tot), '| OANDA total', tot.forex + tot.commodities + tot.indices, 'of', data.instruments.length);
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });
