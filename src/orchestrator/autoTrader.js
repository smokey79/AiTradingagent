/**
 * Autonomous Continuous Multi-Platform Max-Profit Trading Engine
 * Executes across:
 *   1. Spot & 5X Futures on Bitget & Crypto.com / Binance (SMC Order Blocks, 72% Gate)
 *   2. Zero-Capital DeFi Flash Loans (Aave v3 & Balancer Vault 0% fee cross-DEX atomic arbitrage)
 *   3. Cross-DEX Spatial Arbitrage across Ethereum, Arbitrum, Base, Cronos, Solana, Polygon
 *   4. DexScreener High-Momentum Meme Coin Breakout Scalper
 * With instant Master ON/OFF toggle controls, dynamic intervals, and WebSocket broadcasting.
 */
const logger = require('../utils/logger');
const { runTradingCycle } = require('./index');
const { detectArbitrageOpportunities } = require('../arbitrage/arbScanner');
const { executeFlashLoanArbitrage } = require('../flashloan/flashloanExecutor');
const { scanTrendingMemeCoins } = require('../data/dexScreenerFeed');
const { recordTrade } = require('../risk/tradeLedger');
const { getPortfolioState } = require('../risk/riskGate');
const { isKillSwitchEngaged } = require('../utils/killSwitch');
const { getVaultSummary } = require('../utils/profitAllocator');
const { startHealthChecks, updateHeartbeat } = require('../health/systemHealthCheck');
const { startContinuousArb, stopContinuousArb, getStatus: getArbStatus } = require('../arbitrage/continuousArbEngine');

let autoTradingInterval = null;
let isAutoTradingActive = false;
let intervalSeconds = parseInt(process.env.AUTO_TRADE_INTERVAL_SEC || '30', 10);
let lastRunTimestamp = null;
let nextRunTimestamp = null;
let totalAutoCycles = 0;
let totalAutoTrades = 0;
let totalFlashLoanTrades = 0;
let totalMemeTrades = 0;
let totalAutoProfitUsd = 0;

/**
 * Start Autonomous Multi-Platform Trading Loop
 * @param {number} [seconds=30] - Interval between trading cycles in seconds
 * @param {boolean} [runImmediate=true] - Whether to trigger first cycle immediately
 */
function startAutoTrading(seconds = 15, runImmediate = true) {
  if (seconds) {
    intervalSeconds = seconds;
  }
  if (isAutoTradingActive) {
    logger.info(`Auto-trading is already active`);
    return getAutoTradingStatus();
  }

  isAutoTradingActive = true;
  lastRunTimestamp = new Date().toISOString();

  logger.info(`🟢 [AutoTrader] Multi-Platform Autonomous Trading Engine STARTED — Dynamic Activity Feedback Mode`);

  // Start health monitor alongside the trading loop
  startHealthChecks();

  // Start the dedicated high-speed continuous arbitrage engine in the background
  startContinuousArb();

  // Begin recursive timeout chain
  scheduleNextCycle(runImmediate ? 0 : (seconds || 15) * 1000);

  return getAutoTradingStatus();
}

/**
 * Stop Autonomous Trading Loop
 */
function stopAutoTrading() {
  if (autoTradingInterval) {
    clearTimeout(autoTradingInterval);
    autoTradingInterval = null;
  }
  isAutoTradingActive = false;
  nextRunTimestamp = null;

  // Stop the continuous arbitrage engine
  stopContinuousArb();

  logger.info(`🛑 [AutoTrader] Autonomous Trading Engine HALTED`);
  return getAutoTradingStatus();
}

/**
 * Recursive Timeout Chain with Dynamic Feedback Scheduling
 */
async function scheduleNextCycle(delayMs = 15000) {
  if (!isAutoTradingActive) return;

  if (autoTradingInterval) {
    clearTimeout(autoTradingInterval);
  }

  nextRunTimestamp = new Date(Date.now() + delayMs).toISOString();
  autoTradingInterval = setTimeout(async () => {
    try {
      await executeAutonomousCycle();
    } catch (err) {
      logger.error(`[AutoTrader] Error during dynamic cycle: ${err.message}`);
    }

    if (isAutoTradingActive) {
      const portfolio = getPortfolioState();
      const hasOpen = portfolio && portfolio.openCount > 0;
      const nextDelayMs = hasOpen ? 5000 : 15000;
      
      logger.info(`⏱️ [AutoTrader] Next autonomous cycle scheduled in ${(nextDelayMs / 1000).toFixed(0)}s (dynamic feedback)...`);
      scheduleNextCycle(nextDelayMs);
    }
  }, delayMs);
}

/**
 * Toggle Autonomous Trading Loop
 */
function toggleAutoTrading(seconds = 15, runImmediate = true) {
  if (isAutoTradingActive) {
    return stopAutoTrading();
  } else {
    return startAutoTrading(seconds, runImmediate);
  }
}

/**
 * Execute comprehensive multi-platform automated cycle
 */
async function executeAutonomousCycle() {
  if (!isAutoTradingActive) return;

  // Kill switch check — added 2026-09-03, same flag runTradingCycle() checks
  // in orchestrator/index.js. Keeps the meme-coin scalper (Phase 3, runs
  // independently of runTradingCycle) from opening new positions too.
  const killSwitch = isKillSwitchEngaged();
  if (killSwitch) {
    logger.warn(`🛑 [AutoTrader] Kill switch engaged (${killSwitch.reason}) — skipping autonomous cycle #${totalAutoCycles + 1}.`);
    return;
  }

  try {
    lastRunTimestamp = new Date().toISOString();
    totalAutoCycles++;
    updateHeartbeat(); // 🩺 notify health monitor the loop is alive

    logger.info(`\n══════════════════════════════════════════════════════════════════════`);
    logger.info(`🤖 [AutoTrader] MULTI-PLATFORM AUTONOMOUS CYCLE #${totalAutoCycles} START`);
    logger.info(`══════════════════════════════════════════════════════════════════════`);

    // ─── 1. Spot & 5X Futures Trading Engine (Bitget / CCXT) ────────────────
    logger.info(`[AutoTrader] Phase 1: Evaluating 5X Futures & Spot AI Consensus...`);
    const results = await runTradingCycle();
    
    if (Array.isArray(results)) {
      const executed = results.filter(r => r && r.executed).length;
      totalAutoTrades += executed;
      results.forEach(r => {
        if (r && r.pnlUsd) totalAutoProfitUsd += Number(r.pnlUsd);
      });
      if (executed > 0) {
        logger.info(`🎯 [AutoTrader] Phase 1 executed ${executed} 5X Futures/Spot trade(s)!`);
      }
    }

    // ─── 2. Zero-Capital DeFi Flash Loan Arbitrage Engine ────────────────────
    // Arbitrage is now handled continuously in the background by continuousArbEngine.js
    // It runs its own 8s tight loop, checking the live arbStatus here to include in dashboard stats.
    const arbStatus = getArbStatus();
    totalFlashLoanTrades = arbStatus.totalArbTrades;
    logger.info(`[AutoTrader] Phase 2: Arbitrage Engine is running in background. Total Arb Trades: ${arbStatus.totalArbTrades} | Profit: $${arbStatus.totalArbProfitUsd}`);

    // ─── 3. DexScreener Trending Meme Coin Breakout Scalper ──────────────────
    logger.info(`[AutoTrader] Phase 3: Scanning DexScreener Breakout Liquidity...`);
    try {
      const memeCoins = await scanTrendingMemeCoins();
      const topBreakout = memeCoins.find(m => m.isBreakout && m.safetyScore >= 88 && (m.change5m > 3.0 || m.change1h > 8.0));

      if (topBreakout) {
        logger.info(`🐸 [AutoTrader] DexScreener Breakout Token Detected: ${topBreakout.name} (${topBreakout.symbol}) on ${topBreakout.chain} | 5m: +${topBreakout.change5m}% | Safety: ${topBreakout.safetyScore}/100`);
        const isPaper = process.env.PAPER_TRADING !== 'false';
        const positionSizeUsd = 25.0; // Controlled micro-allocation

        // Fixed 2026-09-03: this used to fabricate outcome:'WIN' with a random
        // profit (Math.random() * 0.08) on every detection, regardless of what
        // the price actually did afterward — that was silently inflating the
        // recorded win rate. There is no real price-resolution mechanism for
        // meme-coin scalps yet, so we log it honestly as PENDING (excluded
        // from win/loss stats in tradeLedger's getPerformanceStats, which only
        // counts WIN/LOSS/BREAKEVEN) instead of inventing a result.
        // TODO: wire up real resolution (re-check topBreakout's price after a
        // hold window, like riskGate.js's openPositions TTL does) before this
        // should count toward win-rate numbers.
        recordTrade({
          symbol: `${topBreakout.symbol}/USD`,
          side: 'BUY',
          price: topBreakout.priceUsd || 0.01,
          size: (positionSizeUsd / (topBreakout.priceUsd || 0.01)),
          positionSizeUsd,
          leverage: 1,
          pnlUsd: 0,
          outcome: 'PENDING',
          confidence: topBreakout.safetyScore / 100,
          reason: `DexScreener Breakout Scalp on ${topBreakout.chain} (+${topBreakout.change1h}% 1h vol surge) — outcome not yet resolved`,
          paper: isPaper,
        });

        totalMemeTrades++;
        logger.info(`📝 [AutoTrader] Meme Coin Breakout Scalp logged as PENDING (no fabricated P&L — real outcome resolution not yet implemented).`);
      }
    } catch (memeErr) {
      logger.warn(`[AutoTrader] Meme scan notice: ${memeErr.message}`);
    }

    // ─── 4. Broadcast Master Update to Dashboard ────────────────────────────
    if (global.broadcastDashboardEvent) {
      global.broadcastDashboardEvent({
        type: 'autotrading_cycle_completed',
        cycle: totalAutoCycles,
        totalTrades: totalAutoTrades,
        totalFlashLoans: totalFlashLoanTrades,
        totalMemeTrades,
        totalProfitUsd: totalAutoProfitUsd,
        portfolio: getPortfolioState(),
        vault: getVaultSummary(),
        timestamp: new Date().toISOString(),
      });
    }

    logger.info(`🏁 [AutoTrader] Cycle #${totalAutoCycles} Complete | Total Generated Profit: $${totalAutoProfitUsd.toFixed(2)} USD\n`);
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
    totalFlashLoanTrades,
    totalMemeTrades,
    totalAutoProfitUsd: parseFloat(totalAutoProfitUsd.toFixed(2)),
    pairs: (process.env.TRADING_PAIRS || 'BTC/USDT,ETH/USDT,SOL/USDT,CRO/USDT,AVAX/USDT,ARB/USDT').split(','),
    mode: process.env.PAPER_TRADING !== 'false' ? 'PAPER' : 'LIVE',
  };
}

module.exports = {
  startAutoTrading,
  stopAutoTrading,
  toggleAutoTrading,
  getAutoTradingStatus,
  executeAutonomousCycle,
};

