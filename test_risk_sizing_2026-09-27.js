// One-off validation script for the 2026-09-27 risk-sizing upgrade
// (MAX_RISK_PER_TRADE_PCT cap, portfolio heat check, score-scaled sizing).
// Forces an APPROVAL path with mocked high-confidence consensus + majority
// agreement, since live market conditions right now (CHOPPY_RANGING, low
// confidence) never reach the sizing code. Prints the full decision object
// so every new field can be eyeballed. Not wired into any process; run once
// manually and safe to delete afterwards.
'use strict';
process.env.PAPER_TRADING = 'true';

const riskGate = require('./src/risk/riskGate');

async function main() {
  const consensus = {
    signal: 'BUY',
    confidence: 0.85,
    agentsAgreeing: 9,
    totalAgents: 13,
    veto_triggered: false,
    regime: 'BULLISH_EXPANSION',
  };
  const marketData = {
    price: { price: 50000 },
    indicators: { atr14: 800, rsi14: 55 },
    btcBenchmark: { trend: 'NEUTRAL', change24h: 1.2 },
  };

  const result = await riskGate.checkRiskGate('BTC/USDT', consensus, marketData);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error('TEST THREW:', err);
  process.exit(1);
});
