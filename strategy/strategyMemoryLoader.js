const fs = require("fs");
const path = require("path");
const logger = require("../src/utils/logger.js");

const MEMORY_PATH = path.resolve("src/strategy/strategy_memory.json");

function loadStrategyMemory() {
  try {
    return JSON.parse(fs.readFileSync(MEMORY_PATH, "utf-8"));
  } catch (err) {
    logger.error("Failed to load strategy_memory.json, starting fresh", {
      error: err.message,
    });
    return { version: 1, lastUpdated: null, tradeHistory: [], channelCredibility: {} };
  }
}

function appendTradeRecord(memory, record) {
  memory.tradeHistory.push({ ...record, timestamp: new Date().toISOString() });
  memory.lastUpdated = new Date().toISOString();
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2));
  return memory;
}

module.exports = {
  loadStrategyMemory,
  appendTradeRecord,
};
