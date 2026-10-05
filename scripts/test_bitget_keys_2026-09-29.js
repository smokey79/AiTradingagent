// test_bitget_keys_2026-09-29.js
// READ-ONLY check of the Bitget API keys in .env. Places NO orders.
// Tries the keys against (a) the live account and (b) Bitget Demo Trading
// (ccxt enableDemoTrading -> adds the "paptrading: 1" header).
// Prints only success/failure + non-zero balances. Never prints keys.
// Optional arg: path to a different env file (e.g. config\.env). Default: project .env
const envPath = process.argv[2] || require('path').resolve(__dirname, '..', '.env');
require('dotenv').config({ path: envPath, override: true });
console.log('env file:', envPath);
const ccxt = require('ccxt');

function make() {
  return new ccxt.bitget({
    apiKey: process.env.BITGET_API_KEY,
    secret: process.env.BITGET_API_SECRET || process.env.BITGET_SECRET || process.env.BITGET_SECRET_KEY,
    password: process.env.BITGET_API_PASSPHRASE || process.env.BITGET_PASSPHRASE,
    options: { defaultType: 'spot' },
  });
}

function nonZero(bal) {
  const out = {};
  for (const [k, v] of Object.entries(bal.total || {})) if (v && v > 0) out[k] = v;
  return out;
}

(async () => {
  console.log('ccxt version:', ccxt.version);
  for (const mode of ['LIVE', 'DEMO']) {
    const ex = make();
    try {
      if (mode === 'DEMO') {
        if (typeof ex.enableDemoTrading !== 'function') { console.log('DEMO: this ccxt has no enableDemoTrading()'); continue; }
        ex.enableDemoTrading(true);
      }
      for (const type of ['spot', 'swap']) {
        try {
          const bal = await ex.fetchBalance({ type });
          console.log(`${mode} ${type}: OK`, JSON.stringify(nonZero(bal)));
        } catch (e) { console.log(`${mode} ${type}: FAIL ${e.constructor.name}: ${String(e.message).slice(0, 180)}`); }
      }
    } catch (e) { console.log(`${mode}: FAIL ${e.message.slice(0, 180)}`); }
  }
})();
