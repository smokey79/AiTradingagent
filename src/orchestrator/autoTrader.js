/**
 * Autonomous Continuous Trading Engine
 * Manages the background automated execution loop with start/stop controls,
 * dynamic interval scheduling, and WebSocket event broadcasts.
 */
const logger = require('../utils/logger');
const { runTradingCycle } = require('./index');

let autoTradingInterval = null;
let isAutoTradingActive = false;
let intervalSeconds = parseInt(process.env.AUTO_TRADE_INTERVAL_SEC || '30', 10);
let lastRunTimestamp = null;
let nextRunTimestamp = null;
let totalAutoCycles = 0;
let totalAutoTrades = 0;

/**
 * Start Autonomous Trading Loop
 * @param {number} [seconds=30] - Interval between trading cycles in seconds
 * @param {boolean} [runImmediate=true] - Whether to trigger first cycle immediately
 */
function startAutoTrading(seconds = 30, runImmediate = true) {
  if (isAutoTradingActive) {
    logger.info(`Auto-trading is already active (interval: ${intervalSeconds}s)`);
    return getAutoTradingStatus();
  }

  intervalSeconds = Math.max(10, Math.min(3600, parseInt(seconds || 30, 10)));
  isAutoTradingActive = true;
  lastRunTimestamp = new Date().toISOString();
  nextRunTimestamp = new Date(Date.now() + intervalSeconds * 1000).toISOString();

  logger.info(`🟢 [AutoTrader] Starting Autonomous Trading Engine — Interval: ${intervalSeconds}s`);

  // Run initial cycle if requested
  if (runImmediate) {
    executeAutonomousCycle();
  }

  // Schedule recurring interval
  autoTradingInterval = setInterval(() => {
    executeAutonomousCycle();
  }, intervalSeconds * 1000);

  return getAutoTradingStatus();
}

/**
 * Stop Autonomous Trading Loop
 */
function stopAutoTrading() {
  if (autoTradingInterval) {
    clearInterval(autoTradingInterval);
    autoTradingInterval = null;
  }
  isAutoTradingActive = false;
  nextRunTimestamp = null;

  logger.info(`🛑 [AutoTrader] Autonomous Trading Engine HALTED`);
  return getAutoTradingStatus();
}

/**
 * Toggle Autonomous Trading Loop
 */
function toggleAutoTrading(seconds = 30, runImmediate = true) {
  if (isAutoTradingActive) {
    return stopAutoTrading();
  } else {
    return startAutoTrading(seconds, runImmediate);
  }
}

/**
 * Execute single cycle and track metrics
 */
async function executeAutonomousCycle() {
  if (!isAutoTradingActive) return;

  try {
    lastRunTimestamp = new Date().toISOString();
    nextRunTimestamp = new Date(Date.now() + intervalSeconds * 1000).toISOString();
    totalAutoCycles++;

    logger.info(`🤖 [AutoTrader] Executing automated cycle #${totalAutoCycles}...`);
    const results = await runTradingCycle();
    
    if (Array.isArray(results)) {
      const executed = results.filter(r => r && r.executed).length;
      totalAutoTrades += executed;
      if (executed > 0) {
        logger.info(`🎯 [AutoTrader] Cycle #${totalAutoCycles} placed ${executed} automated trade(s)!`);
      }
    }
  } catch (err) {
    logger.error(`[AutoTrader] Autonomous cycle #${totalAutoCycles} error: ${err.message}`);
  }
}

/**
 * Get Current Auto-Trading Status
 */
function getAutoTradingStatus() {
  const remainingSeconds = (isAutoTradingActive && nextRunTimestamp)
    ? Math.max(0, Math.round((new Date(nextRunTimestamp).getTime() - Date.now()) / 1000))
    : 0;

  return {
    isActive: isAutoTradingActive,
    status: isAutoTradingActive ? 'RUNNING' : 'STOPPED',
    intervalSeconds,
    remainingSeconds,
    lastRunTimestamp,
    nextRunTimestamp,
    totalAutoCycles,
    totalAutoTrades,
    pairs: (process.env.TRADING_PAIRS || 'BTC/USDT,ETH/USDT,SOL/USDT,CRO/USDT,AVAX/USDT,ARB/USDT').split(','),
    mode: process.env.PAPER_TRADING !== 'false' ? 'PAPER' : 'LIVE',
  };
}

module.exports = {
  startAutoTrading,
  stopAutoTrading,
  toggleAutoTrading,
  getAutoTradingStatus,
};
