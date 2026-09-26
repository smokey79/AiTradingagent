/**
 * scripts/alpaca_check.js - read-only Alpaca connection check. Places NO orders.
 * Shows environment, account status/cash/buying power, a latest AAPL trade
 * price, and (if configured) a latest BTC/USD crypto trade price.
 * Usage (from F:\aitradingagent): node scripts/alpaca_check.js
 */
const alpaca = require('../src/brokers/alpacaBroker');
(async () => {
  console.log(`Alpaca environment: ${alpaca.ENV} (${alpaca.BASE})`);
  const a = await alpaca.getAccount();
  console.log(`Account ${a.status} | cash $${parseFloat(a.cash).toFixed(2)} | buying power $${parseFloat(a.buying_power).toFixed(2)} | blocked=${a.trading_blocked}`);

  try {
    const px = await alpaca.getPrice('AAPL');
    console.log(`AAPL latest trade: $${px.price} @ ${px.ts}`);
  } catch (e) { console.log(`AAPL price check failed: ${e.message}`); }

  try {
    const cpx = await alpaca.getPrice('BTC/USD');
    console.log(`BTC/USD latest trade: $${cpx.price} @ ${cpx.ts}`);
  } catch (e) { console.log(`BTC/USD price check failed: ${e.message}`); }

  const gate = alpaca.liveGateStatus();
  console.log(`Live gate: ${gate.passed ? 'PASSED' : 'not passed'} (${gate.trades ?? 0}/${gate.requiredTrades ?? 250} trades)`);
  process.exit(0);
})().catch((e) => { console.log('ERROR', e.message); process.exit(1); });
