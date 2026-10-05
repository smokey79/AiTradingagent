// test_bitget_demo_keys.js — READ-ONLY test of the BITGET_DEMO_* keys in .env against Bitget DEMO trading
// (ccxt enableDemoTrading -> "paptrading: 1" header). Places no orders. Never prints keys.
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env'), override: true });
const ccxt = require('ccxt');
(async () => {
  const ex = new ccxt.bitget({
    apiKey: process.env.BITGET_DEMO_API_KEY, secret: process.env.BITGET_DEMO_SECRET, password: process.env.BITGET_DEMO_PASSPHRASE,
  });
  ex.enableDemoTrading(true);
  let ok = false;
  for (const type of ['swap', 'spot']) {
    try {
      const b = await ex.fetchBalance({ type });
      const nz = Object.fromEntries(Object.entries(b.total || {}).filter(([, v]) => v > 0));
      console.log(`DEMO ${type}: OK ${JSON.stringify(nz)}`); ok = true;
    } catch (e) { console.log(`DEMO ${type}: FAIL ${String(e.message).slice(0, 160)}`); }
  }
  process.exit(ok ? 0 : 1);
})();
