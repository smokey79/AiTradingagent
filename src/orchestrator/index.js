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

const PAPER = process.env.PAPER_TRADING !== 'false';
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE || '0.72');

let isCycleRunning = false;
let dynamicPairsCache = null;
let lastPairsCacheUpdate = 0;

async function getActivePairs() {
  const now = Date.now();
  if (dynamicPairsCache && (now - lastPairsCacheUpdate < 15 * 60 * 1000)) {
    return dynamicPairsCache;
  }

  try {
    const ccxt = require('ccxt');
    const exchange = new ccxt.binance({ enableRateLimit: true });
    logger.info('🔄 [Orchestrator] Fetching active tickers from Binance to build dynamic universe...');
    const tickers = await exchange.fetchTickers();
    const candidates = Object.keys(tickers)
      .filter(sym => sym.endsWith('/USDT') && tickers[sym].quoteVolume > 0 && tickers[sym].last > 0)
      .map(sym => ({
        symbol: sym,
        volume: tickers[sym].quoteVolume * (tickers[sym].last || 1.0)
      }));

    candidates.sort((a, b) => b.volume - a.volume);
    const selected = candidates.slice(0, 25).map(c => c.symbol);
    
    // Ensure core majors are always in the list
    const core = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'CRO/USDT', 'AVAX/USDT', 'ARB/USDT'];
    for (const c of core) {
      if (!selected.includes(c)) {
        selected.push(c);
      }
    }

    dynamicPairsCache = selected;
    lastPairsCacheUpdate = now;
    logger.info(`✨ [Orchestrator] Dynamic universe built with ${selected.length} pairs (Top Volume): ${selected.join(', ')}`);
    return selected;
  } catch (err) {
    logger.warn(`⚠️ [Orchestrator] Failed to fetch dynamic pairs: ${err.message}. Using default environment pairs.`);
    return (process.env.TRADING_PAIRS || 'BTC/USDT,ETH/USDT,SOL/USDT,CRO/USDT,AVAX/USDT,ARB/USDT').split(',');
  }
}

async function runTradingCycle() {
  if (isCycleRunning) {
    logger.warn('Trading cycle already in progress — skipping duplicate trigger');
    return;
  }
  isCycleRunning = true;
  const cycleStart = Date.now();

  const pairs = await getActivePairs();

  logger.info(`\n══════════════════════════════════════════════════════════════════════`);
  logger.info(`🚀 TRADING CYCLE START — Mode: ${PAPER ? '📄 PAPER' : '🔴 LIVE'} | Universe: ${pairs.length} pairs [PARALLEL]`);
  logger.info(`══════════════════════════════════════════════════════════════════════`);

  // ── Step 1: Batch fetch CoinMarketCap quotes once to avoid rate limiting ──
  const symbols = pairs.map(p => p.split('/')[0].toUpperCase());
  logger.info(`⚡ [Batch] Fetching CoinMarketCap quotes for ${symbols.length} symbols...`);
  let cmcQuotes = null;
  try {
    const { fetchCoinMarketCapQuotes } = require('../data/coinmarketcapFeed');
    cmcQuotes = await fetchCoinMarketCapQuotes(symbols);
  } catch (err) {
    logger.warn(`⚠️ [Batch] CoinMarketCap batch fetch failed: ${err.message} — falling back to exchange tickers`);
  }

  // ── Step 2: Pre-fetch ALL market data in parallel using cache ─────────────
  logger.info(`⚡ [Parallel] Fetching market data for ${pairs.length} pairs simultaneously...`);
  const marketDataMap = {};
  await Promise.allSettled(
    pairs.map(async (pair) => {
      try {
        marketDataMap[pair] = await fetchMarketData(pair, cmcQuotes);
      } catch (err) {
        logger.warn(`[${pair}] Market data fetch failed: ${err.message}`);
        marketDataMap[pair] = null;
      }
    })
  );
  logger.info(`⚡ [Parallel] Market data ready in ${Date.now() - cycleStart}ms`);

  // ── Step 2: Run consensus + execution for ALL pairs in parallel ────────────
  const pairResults = await Promise.allSettled(
    pairs.map(async (pair) => {
      const pairStart = Date.now();
      const marketData = marketDataMap[pair];

      if (!marketData) {
        return { pair, signal: 'HOLD', executed: false, reason: 'Market data unavailable' };
      }

      logger.info(
        `  [${pair}] Price: $${marketData.price.price.toFixed(2)} ` +
        `(${marketData.price.change24h >= 0 ? '+' : ''}${marketData.price.change24h.toFixed(2)}%) ` +
        `| RSI: ${marketData.indicators.rsi14.toFixed(1)} | F&G: ${marketData.fearGreed.value}`
      );

      // Consensus
      const consensus = await runConsensus(pair, marketData);

      if (global.broadcastDashboardEvent) {
        global.broadcastDashboardEvent({
          type: 'agent_consensus',
          pair,
          consensus,
          marketData: { price: marketData.price, indicators: marketData.indicators, fearGreed: marketData.fearGreed },
        });
      }

      if (!consensus.approved_for_execution) {
        logger.info(`[${pair}] ⚠️ Consensus skipped: ${consensus.reasoning}`);
        return { pair, signal: consensus.signal, executed: false, reason: consensus.reasoning };
      }

      // Risk Gate
      const riskCheck = await checkRiskGate(pair, consensus, marketData);
      riskCheck.consensusConfidence = consensus.confidence;

      if (!riskCheck.approved) {
        logger.info(`[${pair}] 🛑 Risk Gate: ${riskCheck.reason}`);
        return { pair, signal: consensus.signal, executed: false, reason: `Risk Gate: ${riskCheck.reason}` };
      }

      // Execute
      const tradeResult = await executeTrade(pair, consensus.signal, riskCheck, marketData, PAPER);
      const allocation  = await allocateProfits(tradeResult);

      if (global.broadcastDashboardEvent) {
        global.broadcastDashboardEvent({
          type: 'trade_executed',
          trade: tradeResult,
          portfolio: getPortfolioState(),
          vault: getVaultSummary(),
          performance: getPerformanceStats(20),
        });
      }

      logger.info(`[${pair}] ✅ Done in ${Date.now() - pairStart}ms | PnL: $${tradeResult.pnlUsd}`);
      return { pair, signal: consensus.signal, executed: true, sizeUsd: riskCheck.positionSizeUsd, leverage: riskCheck.leverage, pnlUsd: tradeResult.pnlUsd, allocation };
    })
  );

  // Flatten results
  const cycleResults = pairResults.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { pair: pairs[i], executed: false, reason: r.reason?.message }
  );

  isCycleRunning = false;
  const totalMs = Date.now() - cycleStart;
  logger.info(`\n══════════════════════════════════════════════════════════════════════`);
  logger.info(`🏁 CYCLE DONE in ${totalMs}ms | Portfolio: $${getPortfolioState().currentBalance} USD`);
  logger.info(`══════════════════════════════════════════════════════════════════════\n`);
  return cycleResults;
}


module.exports = {
  runTradingCycle,
};

if (require.main === module) {
  const { startAutoTrading } = require('./autoTrader');
  if (process.argv.includes('--once')) {
    runTradingCycle().then(() => {
      logger.info('Single cycle complete (--once specified). Exiting.');
      process.exit(0);
    }).catch(err => {
      logger.error(`Fatal orchestrator cycle error: ${err.message}`);
      process.exit(1);
    });
  } else {
    const intervalSec = parseInt(process.env.AUTO_TRADE_INTERVAL_SEC || '30', 10);
    logger.info(`🚀 Starting Full-Stack Continuous Auto-Trading Engine (${intervalSec}s loop)...`);
    startAutoTrading(intervalSec, true);
  }
}

