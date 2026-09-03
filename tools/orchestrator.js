const fs = require("fs");
const path = require("path");
const { runConsensus } = require("../src/orchestrator/consensus");

async function runTradingOrchestrator(marketData = {}, symbol = "BTC/USDT") {
  const decision = await runConsensus(symbol, marketData);
  try {
    fs.writeFileSync(
      path.resolve(__dirname, "../last_orchestration.json"),
      JSON.stringify(decision, null, 2)
    );
  } catch (e) {}
  return decision;
}

module.exports = { runTradingOrchestrator };
