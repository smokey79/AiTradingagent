const j = require('../src/learning/jedaiAdvisor');
const r = j.evaluateSimilarity(
  'ETH/USDT',
  'BUY',
  { indicators: { rsi14: 55, ema20: 100, ema50: 99, volumeRatio: 1.1 }, price: { price: 101 } },
  { change24h: 0.5 }
);
console.log('No-memory-yet case:', JSON.stringify(r));
console.log('OK - no throw');
