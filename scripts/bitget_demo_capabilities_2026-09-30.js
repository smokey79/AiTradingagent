// READ-ONLY capability check for the Bitget DEMO account (uses BITGET_DEMO_* from .env).
// Reports balances and what markets demo can trade. Places NO orders. Prints no key values.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const ccxt = require('ccxt');
(async () => {
  const ex = new ccxt.bitget({ apiKey: process.env.BITGET_DEMO_API_KEY, secret: process.env.BITGET_DEMO_SECRET, password: process.env.BITGET_DEMO_PASSPHRASE });
  ex.enableDemoTrading(true);
  for (const type of ['swap', 'spot']) {
    try {
      const b = await ex.fetchBalance({ type });
      const nz = Object.entries(b.total || {}).filter(([, v]) => v > 0).map(([c, v]) => `${c} ${Number(v).toFixed(2)}`);
      console.log(`${type} balance: ${nz.join(', ') || '(empty)'}`);
    } catch (e) { console.log(`${type} balance: FAIL ${String(e.message).slice(0, 100)}`); }
  }
  try {
    const m = Object.values(await ex.loadMarkets());
    const swaps = m.filter(x => x.swap && x.active); const usdt = swaps.filter(x => x.settle === 'USDT');
    const stockLike = usdt.filter(x => /^(AAPL|TSLA|NVDA|MSFT|AMZN|GOOGL|META|COIN|MSTR|SPY|QQQ)/.test(x.base));
    console.log(`markets: ${m.filter(x => x.spot && x.active).length} spot, ${usdt.length} USDT perpetuals, ${swaps.length - usdt.length} other perps`);
    console.log(`stock-style perpetuals found: ${stockLike.map(x => x.base).join(', ') || 'none listed via API'}`);
  } catch (e) { console.log('markets: FAIL ' + String(e.message).slice(0, 100)); }
  try { const p = await ex.fetchPositions(undefined, { productType: 'USDT-FUTURES' }); console.log(`open demo positions: ${p.length}`); }
  catch (e) { console.log('positions: FAIL ' + String(e.message).slice(0, 100)); }
})();
