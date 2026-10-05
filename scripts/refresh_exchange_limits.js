// scripts/refresh_exchange_limits.js -- one-off refresh of data/exchange_limits.json (public endpoints, no keys).
'use strict';
const { refresh, OUT } = require('../src/utils/exchangeLimits');
const realism = require('../src/utils/realism');

refresh().then((p) => {
  console.log(`OK: ${p.count} ${p.exchange} spot USDT pairs cached -> ${OUT}`);
  for (const sym of ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'AVAX/USDT', 'ARB/USDT', 'OP/USDT', 'LINK/USDT']) {
    const m = realism.minOrderUsd(sym);
    console.log(`  ${sym.padEnd(10)} minimum order ~ $${m.minUsd} (${m.source})`);
  }
}).catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
