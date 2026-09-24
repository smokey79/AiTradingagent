/**
 * scripts/t212_check.js - read-only Trading 212 connection check. Places NO orders.
 * Shows environment, account cash/summary, and which crypto-linked stocks in
 * config/instrument_universe.json are tradable on your account.
 * Usage (from F:\aitradingagent): node scripts/t212_check.js
 */
const t212 = require('../src/brokers/trading212Broker');
const universe = require('../config/instrument_universe.json');
(async () => {
  console.log(`Trading 212 environment: ${t212.ENV} (${t212.BASE})`);
  const summary = await t212.getAccountSummary();
  console.log('Account:', JSON.stringify(summary).slice(0, 300));
  for (const sym of universe.classes.crypto_equities.symbols) {
    const t = await t212.findTicker(sym);
    console.log(`  ${sym.padEnd(5)} -> ${t ? `${t.ticker} (${t.name}, ${t.currency})` : 'NOT available on this account'}`);
  }
  const gate = t212.liveGateStatus();
  console.log(`Live gate: ${gate.passed ? 'PASSED' : 'not passed'} (${gate.trades ?? 0}/${gate.requiredTrades ?? 250} trades)`);
  process.exit(0);
})().catch((e) => { console.log('ERROR', e.message); process.exit(1); });
