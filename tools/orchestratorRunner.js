const { runTradingOrchestrator } = require("./orchestrator.js");
const logger = require("../src/utils/logger.js");

async function main() {
  const marketData = {}; // plug in your feed
  const ruling = await runTradingOrchestrator(marketData);
  logger.info("Final ruling", ruling);
}

if (require.main === module) {
  main();
}

module.exports = { main };