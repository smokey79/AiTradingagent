import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";

const MEMORY_PATH = path.resolve("src/strategy/strategy_memory.json");

export function loadStrategyMemory() {
  try {
    return JSON.parse(fs.readFileSync(MEMORY_PATH, "utf-8"));
  } catch (err) {
    logger.error("Failed to load strategy_memory.json, starting fresh", {
      error: err.message,
    });
    return { version: 1, lastUpdated: null, tradeHistory: [], channelCredibility: {} };
  }
}

export function appendTradeRecord(memory, record) {
  memory.tradeHistory.push({ ...record, timestamp: new Date().toISOString() });
  memory.lastUpdated = new Date().toISOString();
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2));
  return memory;
}
