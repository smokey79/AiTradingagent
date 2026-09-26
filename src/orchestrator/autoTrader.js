/**
 * Autonomous Continuous Multi-Platform Max-Profit Trading Engine
 * Executes across:
 *   1. Spot & 5X Futures on Bitget & Crypto.com / Binance (SMC Order Blocks, 72% Gate)
 *   2. Zero-Capital DeFi Flash Loans (Aave v3 & Balancer Vault 0% fee cross-DEX atomic arbitrage)
 *   3. Cross-DEX Spatial Arbitrage across Ethereum, Arbitrum, Base, Cronos, Solana, Polygon
 *   4. DexScreener High-Momentum Meme Coin Breakout Scalper
 * With instant Master ON/OFF toggle controls, dynamic intervals, and WebSocket broadcasting.
 */
const axios = require('axios');
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

// ── Open breakout scalp positions for live price tick resolution ─────────────
const openBreakoutPositions = new Map();

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

  const killSwitch = isKillSwitchEngaged();
  if (killSwitch) {
    logger.warn(`🛑 [AutoTrader] Kill switch engaged (${killSwitch.reason}) — skipping autonomous cycle #${totalAutoCycles + 1}.`);
    return;
  }

  try {
    lastRunTimestamp = new Date().toISOString();
    totalAutoCycles++;
    updateHeartbeat();

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
    const arbStatus = getArbStatus();
    totalFlashLoanTrades = arbStatus.totalArbTrades;
    logger.info(`[AutoTrader] Phase 2: Arbitrage Engine is running in background. Total Arb Trades: ${arbStatus.totalArbTrades} | Profit: $${arbStatus.totalArbProfitUsd}`);

    // ─── 3. DexScreener Trending Breakout Scalper (Live Ingestion & Tick Resolution) ───
    logger.info(`[AutoTrader] Phase 3: Scanning DexScreener Breakout Liquidity...`);
    try {
      // Step A: Resolve existing open breakout positions against live DexScreener prices
      if (openBreakoutPositions.size > 0) {
        for (const [symbol, pos] of openBreakoutPositions.entries()) {
          try {
            const pairUrl = pos.pairAddress
              ? `https://api.dexscreener.com/latest/dex/pairs/${pos.chain}/${pos.pairAddress}`
              : `https://api.dexscreener.com/latest/dex/search?q=${symbol}`;
            const { data } = await axios.get(pairUrl, { timeout: 3000 });
            const pairData = data.pair || data.pairs?.[0];
            const currentPrice = parseFloat(pairData?.priceUsd || 0);

            if (currentPrice > 0 && pos.entryPrice > 0) {
              const rawMovePct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
              const ageMs = Date.now() - pos.entryTimestamp;
              const hitTP = rawMovePct >= (pos.tpPct || 8.0);
              const hitSL = rawMovePct <= -(pos.slPct || 4.0);
              const timedOut = ageMs > (pos.ttlMs || 10 * 60 * 1000);

              if (hitTP || hitSL || timedOut) {
                const cappedMovePct = hitTP ? (pos.tpPct || 8.0) : hitSL ? -(pos.slPct || 4.0) : rawMovePct;
                const pnlUsd = parseFloat(((pos.positionSizeUsd * cappedMovePct) / 100).toFixed(2));
                const outcome = pnlUsd > 0.01 ? 'WIN' : pnlUsd < -0.01 ? 'LOSS' : 'BREAKEVEN';
                recordTrade({
                  symbol: `${symbol}/USD`,
                  side: 'BUY',
                  price: currentPrice,
                  positionSizeUsd: pos.positionSizeUsd,
                  leverage: 1,
                  pnlUsd,
                  pnlPct: parseFloat(cappedMovePct.toFixed(2)),
                  outcome,
                  confidence: pos.confidence || 0.85,
                  reason: hitTP
                    ? `DexScreener TP hit: +${cappedMovePct.toFixed(2)}% real price gain`
                    : hitSL
                      ? `DexScreener SL hit: ${cappedMovePct.toFixed(2)}% real price move`
                      : `DexScreener scalp closed at market after ${Math.round(ageMs / 60000)}m (${rawMovePct.toFixed(2)}%)`,
                  paper: pos.paper !== false,
                  venue: 'DexScreener-RealResolution',
                });
                openBreakoutPositions.delete(symbol);
                totalAutoProfitUsd += pnlUsd;
                logger.info(`🎯 [AutoTrader] DexScreener Scalp RESOLVED (live price): ${outcome} ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd} on ${symbol} (${rawMovePct.toFixed(2)}%)`);
              }
            }
          } catch (resErr) {
            logger.debug(`[AutoTrader] Breakout resolution check error for ${symbol}: ${resErr.message}`);
          }
        }
      }

      // Step B: Scan for new high-conviction breakout opportunities
      const memeCoins = await scanTrendingMemeCoins();
      const topBreakout = memeCoins.find(m => m.isBreakout && m.safetyScore >= 88 && (m.change5m > 3.0 || m.change1h > 8.0));

      if (topBreakout && !openBreakoutPositions.has(topBreakout.symbol)) {
        logger.info(`🐸 [AutoTrader] DexScreener Breakout Token Detected: ${topBreakout.name} (${topBreakout.symbol}) on ${topBreakout.chain} | 5m: +${topBreakout.change5m}% | Safety: ${topBreakout.safetyScore}/100`);
        const isPaper = process.env.PAPER_TRADING !== 'false';
        const positionSizeUsd = 25.0; // Controlled micro-allocation
        const entryPrice = topBreakout.priceUsd || 0.01;

        openBreakoutPositions.set(topBreakout.symbol, {
          symbol: topBreakout.symbol,
          name: topBreakout.name,
          chain: topBreakout.chain,
          pairAddress: topBreakout.pairAddress,
          entryPrice,
          positionSizeUsd,
          entryTimestamp: Date.now(),
          tpPct: 8.0,
          slPct: 4.0,
          ttlMs: 10 * 60 * 1000,
          confidence: topBreakout.safetyScore / 100,
          paper: isPaper,
        });

        recordTrade({
          symbol: `${topBreakout.symbol}/USD`,
          side: 'BUY',
          price: entryPrice,
          size: (positionSizeUsd / entryPrice),
          positionSizeUsd,
          leverage: 1,
          pnlUsd: 0,
          outcome: 'PENDING',
          confidence: topBreakout.safetyScore / 100,
          reason: `DexScreener Breakout Scalp OPENED on ${topBreakout.chain} (+${topBreakout.change1h}% 1h surge) — tracking live ticks for TP(+8%)/SL(-4%)`,
          paper: isPaper,
          venue: 'DexScreener-PendingTick',
        });

        totalMemeTrades++;
        logger.info(`📝 [AutoTrader] Breakout Scalp OPENED: ${topBreakout.symbol} @ $${entryPrice} — awaiting real live price resolution.`);
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

