/**
 * scripts/oanda_check.js - read-only OANDA connection check. Places NO orders.
 * Shows environment, account currency/NAV, which forex/commodity/index symbols in
 * config/instrument_universe.json are tradeable on your account, and a latest EUR/USD candle.
 * Usage (from F:\aitradingagent): node scripts/oanda_check.js
 */
const oanda = require('../src/brokers/oandaBroker');
const universe = require('../config/instrument_universe.json');
(async () => {
  console.log(`OANDA environment: ${oanda.ENV} (${oanda.BASE}), leverage cap ${oanda.LEVERAGE_CAP}x`);
  const a = await oanda.getAccountSummary();
  console.log(`Account currency ${a.currency} | NAV ${a.NAV} | open positions ${a.openPositionCount} | margin rate ${a.marginRate}`);
  const symbols = ['forex', 'commodities', 'indices'].flatMap((k) => universe.classes[k].symbols);
  const avail = new Set((await oanda.getInstruments()).map((i) => i.name));
  for (const s of symbols) {
    const inst = oanda.toInstrument(s);
    console.log(`  ${s.padEnd(8)} -> ${inst.padEnd(11)} ${avail.has(inst) ? 'tradeable' : 'NOT available on this account'}`);
  }
  const c = await oanda.getCandles('EUR/USD', '1h', 3);
  const last = c[c.length - 1];
  if (last) console.log(`Latest EUR/USD 1h candle: ${new Date(last.timestamp).toISOString()} close ${last.close}`);
  const gate = oanda.liveGateStatus();
  console.log(`Live gate: ${gate.passed ? 'PASSED' : 'not passed'} (${gate.trades ?? 0}/${gate.requiredTrades ?? 250} trades)`);
  process.exit(0);
})().catch((e) => { console.log('ERROR', e.message); process.exit(1); });
