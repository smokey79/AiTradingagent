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
const { checkRiskGate, getPortfolioState, resolveAllOpenPositions } = require('../risk/riskGate');
const { isKillSwitchEngaged } = require('../utils/killSwitch');
const { recordSignal, flushSignals } = require('./signalBridge');
const { enrichMarketData, fetchMarketOverview } = require('../data/tradingKitFeed');
const { getLatestSignals } = require('../notifications/telegramListener');
const { executeTrade } = require('../utils/exchangeRouter');
const { allocateProfits, getVaultSummary } = require('../utils/profitAllocator');
const { getPerformanceStats } = require('../risk/tradeLedger');
const { startContinuousLearning } = require('../agents/learningAgent');

const PAPER = process.env.PAPER_TRADING !== 'false';
// Note: removed unused local MIN_CONFIDENCE (2026-09-03) — it was declared
// here but never referenced anywhere in this file, which read like a safety
// gate that did nothing. The real confidence gate is enforced in
// riskGate.js's checkRiskGate() (env var MIN_CONFIDENCE, same name) — this
// file doesn't need its own copy.

let isCycleRunning = false;
let dynamicPairsCache = null;
let lastPairsCacheUpdate = 0;

async function getActivePairs() {
  const now = Date.now();
  if (dynamicPairsCache && (now - lastPairsCacheUpdate < 15 * 60 * 1000)) {
    return dynamicPairsCache;
  }

  // ── 2026-09-16 ─────────────────────────────────────────────────────────
  // TRADING_PAIRS is now AUTHORITATIVE. It previously had NO effect: this
  // function built the universe from Binance top-tickers and only fell back
  // to TRADING_PAIRS if that fetch threw, so a curated pair list was dead
  // config. Worse, the ranking below used `quoteVolume * last` — quoteVolume
  // is ALREADY in the quote currency, so multiplying by price double-counted
  // it and ranked by unit PRICE as much as liquidity. That is how PAXG (gold,
  // ~$4,280) and tokenised equities (TSLAB/CRCLB/METAB/QQQB, $600-700) got
  // into a list meant to be the most liquid pairs — instruments that barely
  // move intraday, which the 2026-09-15 timeout analysis found was a direct
  // cause of every position exiting on the timer instead of a real stop.
  // Binance is also UK-restricted for this account (market data only) while
  // execution is on Bitget.
  // Discovery is now OPT-IN (DYNAMIC_UNIVERSE=true) and can only NARROW or
  // RE-RANK the configured list — never introduce an unvetted instrument.
  const configured = (process.env.TRADING_PAIRS
    || 'BTC/USDT,ETH/USDT,SOL/USDT,CRO/USDT,AVAX/USDT,ARB/USDT')
    .split(',').map(p => p.trim()).filter(Boolean);

  if (process.env.DYNAMIC_UNIVERSE !== 'true') {
    dynamicPairsCache = configured;
    lastPairsCacheUpdate = now;
    logger.info(`[Orchestrator] Universe = ${configured.length} configured pairs (TRADING_PAIRS): ${configured.join(', ')}`);
    return configured;
  }

  try {
    const ccxt = require('ccxt');
    const exchange = new ccxt.binance({ enableRateLimit: true });
    logger.info('🔄 [Orchestrator] Fetching active tickers from Binance to build dynamic universe...');
    const tickers = await exchange.fetchTickers();
    // Only ever rank pairs that are already in TRADING_PAIRS, and rank by
    // quoteVolume DIRECTLY — no `* last` multiplier (that was the bug).
    const candidates = configured
      .filter(sym => tickers[sym] && tickers[sym].quoteVolume > 0 && tickers[sym].last > 0)
      .map(sym => ({
        symbol: sym,
        volume: tickers[sym].quoteVolume
      }));

    candidates.sort((a, b) => b.volume - a.volume);
    const ranked = candidates.map(c => c.symbol);

    // Keep every configured pair. A pair Binance has no ticker for (CRO and
    // other Bitget-traded names) is simply ranked last — a missing Binance
    // ticker is not evidence about a pair that trades on the venue we
    // actually execute on. The old code replaced the list instead of
    // ordering it, which is how curated pairs silently disappeared.
    const selected = [...ranked, ...configured.filter(p => !ranked.includes(p))];

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

  // ── Kill switch check ───────────────────────────────────────────────────
  // Added 2026-09-03. Still resolves already-open positions against real
  // price (so nothing is abandoned mid-flight), but opens NO new positions
  // while engaged. Persists across PM2 restarts via data/KILL_SWITCH_ENGAGED.
  const killSwitch = isKillSwitchEngaged();
  if (killSwitch) {
    logger.warn(`🛑 KILL SWITCH ENGAGED (${killSwitch.reason}, since ${killSwitch.engagedAt}) — skipping new trade evaluation this cycle. Existing positions still resolve against real price.`);
    const pairsForResolveOnly = await getActivePairs();
    const priceMapOnly = {};
    await Promise.allSettled(
      pairsForResolveOnly.map(async (pair) => {
        try {
          const md = await fetchMarketData(pair);
          if (md?.price?.price) priceMapOnly[pair] = md.price.price;
        } catch (e) {}
      })
    );
    const resolvedWhileHalted = resolveAllOpenPositions(priceMapOnly);
    isCycleRunning = false;
    return resolvedWhileHalted.map(t => ({ pair: t.pair, executed: false, reason: 'Kill switch engaged — no new trades', resolved: true }));
  }

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
        const base = await fetchMarketData(pair, cmcQuotes);
        // Enrich with TradingKit real-time data (indicators + signal)
        marketDataMap[pair] = await enrichMarketData(pair, base);
      } catch (err) {
        logger.warn(`[${pair}] Market data fetch failed: ${err.message}`);
        marketDataMap[pair] = null;
      }
    })
  );
  logger.info(`⚡ [Parallel] Market data ready (+ TradingKit) in ${Date.now() - cycleStart}ms`);

  // ── Inject live Telegram signals into market data ───────────────────────
  const tgSignals = getLatestSignals(20);
  if (tgSignals.length > 0) {
    logger.info(`📡 [Telegram] Injecting ${tgSignals.length} live channel signal(s) into consensus`);
    for (const sig of tgSignals) {
      if (!sig.symbol || !marketDataMap[sig.symbol]) continue;
      marketDataMap[sig.symbol].telegramSignal = sig;
    }
  }

  // ── Step 2a: Resolve any open paper positions against REAL current prices ──
  // Added 2026-09-03 alongside the exchangeRouter.js fix that stopped
  // fabricating win/loss with Math.random(). This is where positions opened
  // in a previous cycle actually get their real outcome recorded, once price
  // crosses their take-profit / stop-loss level or their TTL expires.
  const currentPriceMap = {};
  for (const pair of pairs) {
    if (marketDataMap[pair]?.price?.price) {
      currentPriceMap[pair] = marketDataMap[pair].price.price;
    }
  }
  const resolvedPositions = resolveAllOpenPositions(currentPriceMap);
  if (resolvedPositions.length > 0) {
    logger.info(`📊 [Orchestrator] Resolved ${resolvedPositions.length} open position(s) against real price movement this cycle.`);
    if (global.broadcastDashboardEvent) {
      resolvedPositions.forEach(trade => {
        global.broadcastDashboardEvent({ type: 'position_resolved', trade, portfolio: getPortfolioState() });
      });
    }
  }

  // ── Step 2b: BTC Benchmark Analysis & Bull / Bear Market Discovery ────────
  let btcBenchmark = null;
  let topBullPick = null;
  let topBearPick = null;
  try {
    const { getBtcBenchmark } = require('../data/btcBenchmark');
    btcBenchmark = await getBtcBenchmark(marketDataMap);
    logger.info(
      `📊 [Benchmark] Live BTC: $${btcBenchmark.price.toFixed(2)} (${btcBenchmark.change24h >= 0 ? '+' : ''}${btcBenchmark.change24h}%) | Trend: ${btcBenchmark.trend}`
    );

    const bullAgent = require('../agents/bullAgent');
    const bearAgent = require('../agents/bearAgent');

    for (const [p, md] of Object.entries(marketDataMap)) {
      if (!md || !md.price || md.price.price <= 0) continue;
      try {
        const bSig = await bullAgent.getSignal(p, md, btcBenchmark);
        if (bSig.signal === 'BUY' && (!topBullPick || bSig.confidence > topBullPick.confidence)) {
          topBullPick = bSig;
        }
        const sSig = await bearAgent.getSignal(p, md, btcBenchmark);
        if (sSig.signal === 'SELL' && (!topBearPick || sSig.confidence > topBearPick.confidence)) {
          topBearPick = sSig;
        }
      } catch (_) {}
    }

    if (topBullPick) {
      logger.info(
        `🐂 [Bull Agent Alpha] Top Long: ${topBullPick.pair} (${(topBullPick.confidence * 100).toFixed(0)}% conf) | ${topBullPick.setup_type} | ${topBullPick.reason}`
      );
    }
    if (topBearPick) {
      logger.info(
        `🐻 [Bear Agent Alpha] Top Short: ${topBearPick.pair} (${(topBearPick.confidence * 100).toFixed(0)}% conf) | ${topBearPick.setup_type} | ${topBearPick.reason}`
      );
    }
  } catch (benchErr) {
    logger.debug(`BTC benchmark/scanner notice: ${benchErr.message}`);
  }

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

      // Freqtrade signal bridge — mirror this pair's decision out to
      // data/freqtrade_signals.json so ConsensusBridgeStrategy can act on
      // it. Purely additive: doesn't affect the Node execution path below.
      recordSignal(pair, consensus);

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
      riskCheck.consensus = consensus;

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

  // Flush this cycle's signals for Freqtrade to pick up on its next candle.
  flushSignals();

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
    startContinuousLearning();
    startAutoTrading(intervalSec, true);
  }
}

