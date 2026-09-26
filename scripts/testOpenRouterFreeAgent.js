require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getSignal } = require('../src/agents/openrouterFreeAgent');
(async () => {
  const sig = await getSignal('BTC', { price: { price: 65000, change24h: 1.2 }, indicators: { rsi14: 55, ema20: 64000, ema50: 63000 } });
  console.log(JSON.stringify(sig, null, 2));
})();
