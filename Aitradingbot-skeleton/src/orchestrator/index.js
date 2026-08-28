/**
 * AiTradingAgent — Master Trading Orchestrator
 * Runs continuous automated cycles:
 *   1. Fetch live multi-source market data & indicators
 *   2. Run 6-agent parallel AI consensus pipeline
 *   3. Evaluate institutional Risk Gate & Kelly position sizing
 *   4. Execute trade (Live CCXT or realistic Paper Engine)
 *   5. Allocate profits (40% reinvest / 50% BTC savings / 10% vault)
 *   6. Stream live events to WebSocket Trading Dashboard
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const cron = require('node-cron');
const logger = require('../utils/logger');
const { fetchMarketData } = require('../data/marketData');
const { runConsensus } = require('./consensus');
const { checkRiskGate, getPortfolioState } = require('../risk/riskGate');
const { executeTrade } = require('../utils/exchangeRouter');
const { allocateProfits, getVaultSummary } = require('../utils/profitAllocator');
const { getPerformanceStats } = require('../risk/tradeLedger');

const PAIRS = (process.env.TRADING_PAIRS || 'BTC/USDT,ETH/USDT,SOL/USDT,CRO/USDT,AVAX/USDT,ARB/USDT').split(',');
const PAPER = process.env.PAPER_TRADING !== 'false';
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE || '0.72');

let isCycleRunning = false;

async function runTradingCycle() {
  if (isCycleRunning) {
    logger.warn('Trading cycle already in progress — skipping duplicate trigger');
    return;
  }
  isCycleRunning = true;

  logger.info(`\n══════════════════════════════════════════════════════════════════════`);
  logger.info(`🚀 TRADING CYCLE START — Mode: ${PAPER ? '📄 PAPER' : '🔴 LIVE'} | Universe: ${PAIRS.length} pairs`);
  logger.info(`══════════════════════════════════════════════════════════════════════`);

  const cycleResults = [];

  for (const pair of PAIRS) {
    try {
      logger.info(`\n─── [${pair}] Step 1: Fetching Market Data & Indicators ───`);
      const marketData = await fetchMarketData(pair);
      logger.info(
        `  ${pair} Price: $${marketData.price.price.toFixed(2)} (${marketData.price.change24h >= 0 ? '+' : ''}${marketData.price.change24h.toFixed(2)}%) | RSI: ${marketData.indicators.rsi14.toFixed(1)} | F&G: ${marketData.fearGreed.value}`
      );

      logger.info(`─── [${pair}] Step 2: Running 6-Agent AI Consensus ───`);
      const consensus = await runConsensus(pair, marketData);

      // Broadcast cycle step to dashboard if available
      if (global.broadcastDashboardEvent) {
        global.broadcastDashboardEvent({
          type: 'agent_consensus',
          pair,
          consensus,
          marketData: {
            price: marketData.price,
            indicators: marketData.indicators,
            fearGreed: marketData.fearGreed,
          },
        });
      }

      if (!consensus.approved_for_execution) {
        logger.info(`[${pair}] ⚠️ Consensus skipped execution: ${consensus.reasoning}`);
        cycleResults.push({ pair, signal: consensus.signal, executed: false, reason: consensus.reasoning });
        continue;
      }

      logger.info(`─── [${pair}] Step 3: Checking Institutional Risk Gate & Kelly Sizing ───`);
      const riskCheck = await checkRiskGate(pair, consensus, marketData);
      riskCheck.consensusConfidence = consensus.confidence;

      if (!riskCheck.approved) {
        logger.info(`[${pair}] 🛑 Risk Gate Vetoed: ${riskCheck.reason}`);
        cycleResults.push({ pair, signal: consensus.signal, executed: false, reason: `Risk Gate: ${riskCheck.reason}` });
        continue;
      }

      logger.info(`─── [${pair}] Step 4: Executing Trade (${PAPER ? 'Paper' : 'Live'}) ───`);
      const tradeResult = await executeTrade(pair, consensus.signal, riskCheck, marketData, PAPER);

      logger.info(`─── [${pair}] Step 5: Profit Vault Allocation ───`);
      const allocation = await allocateProfits(tradeResult);

      const cycleSummary = {
        pair,
        signal: consensus.signal,
        executed: true,
        sizeUsd: riskCheck.positionSizeUsd,
        leverage: riskCheck.leverage,
        pnlUsd: tradeResult.pnlUsd,
        allocation,
      };
      cycleResults.push(cycleSummary);

      if (global.broadcastDashboardEvent) {
        global.broadcastDashboardEvent({
          type: 'trade_executed',
          trade: tradeResult,
          portfolio: getPortfolioState(),
          vault: getVaultSummary(),
          performance: getPerformanceStats(20),
        });
      }
    } catch (err) {
      logger.error(`[${pair}] Cycle error: ${err.message}`);
    }
  }

  isCycleRunning = false;
  logger.info(`\n══════════════════════════════════════════════════════════════════════`);
  logger.info(`🏁 TRADING CYCLE FINISHED — Portfolio: $${getPortfolioState().currentBalance} USD`);
  logger.info(`══════════════════════════════════════════════════════════════════════\n`);
  return cycleResults;
}

// Automatic 15-minute schedule
if (!process.argv.includes('--once')) {
  cron.schedule('*/15 * * * *', () => {
    runTradingCycle().catch(err => logger.error(`Cron cycle failed: ${err.message}`));
  });
}

module.exports = {
  runTradingCycle,
};

if (require.main === module) {
  runTradingCycle().then(() => {
    if (process.argv.includes('--once')) {
      logger.info('Single cycle complete (--once specified). Exiting.');
      process.exit(0);
    }
  }).catch(err => {
    logger.error(`Fatal orchestrator cycle error: ${err.message}`);
    process.exit(1);
  });
}
