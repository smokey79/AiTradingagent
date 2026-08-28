orchestratorRunnerimport { runTradingOrchestrator } from "./orchestrator.js";
import { logger } from "./utils/logger.js";

async function main() {
  const marketData = {}; // plug in your feed
  const ruling = await runTradingOrchestrator(marketData);
  logger.info("Final ruling", ruling);
}

main();
.js