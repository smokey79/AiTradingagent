/**
 * Bitcoin Benchmark & Relative Performance Engine
 * ===============================================
 * Measures crypto asset performance, relative strength (RS), and trade alpha
 * against the live Bitcoin (BTC) institutional benchmark.
 *
 * Core Capabilities:
 *   1. Real-time BTC Price, Return & Volatility Tracking
 *   2. Cross-Asset Relative Strength (RS vs BTC) Calculation
 *   3. Trade-by-Trade Alpha vs BTC: Alpha% = Trade PnL% - BTC Return%
 *   4. Portfolio vs BTC Buy-and-Hold Outperformance Attribution
 *   5. Market Regime Detection (BTC Leading Bull, Altcoin Expansion, BTC Liquidity Drain)
 */

'use strict';

const axios = require('axios');
const ccxt = require('ccxt');
const logger = require('../utils/logger');

const CACHE_TTL_MS = 15 * 1000;

// Seed values, used only until the first successful live fetch populates the
// cache. `source` distinguishes seed / live / stale data for consumers.
let btcCache = {
  price: 68500.0,
  change24h: 0.0,
  change1h: 0.0,
  high24h: 69500.0,
  low24h: 67500.0,
  volatilityAtrPct: 1.8,
  trend: 'NEUTRAL',
  timestamp: 0,
  source: 'seed',
};

// De-dupes concurrent network refreshes: a burst of callers on a cold cache
// triggers a single fetch and all await the same promise.
let inFlightRefresh = null;

// Reused CCXT Binance client for the fallback path (instantiating one per call
// is measurably expensive and leaks listeners).
let _binance = null;
function getBinanceClient() {
  if (!_binance) {
    _binance = new ccxt.binance({ enableRateLimit: true, timeout: 4000 });
  }
  return _binance;
}

const round2 = (n) => parseFloat(Number(n || 0).toFixed(2));

/**
 * Classify BTC trend from 24h / 1h change.
 * `change1h` is optional; when unknown (null/undefined) only the 24h move counts.
 */
function classifyTrend(change24h, change1h = null) {
  const h1Known = typeof change1h === 'number';
  if (change24h > 1.5 && (!h1Known || change1h >= 0)) return 'BULLISH_EXPANSION';
  if (change24h < -1.5 && (!h1Known || change1h <= 0)) return 'BEARISH_CONTRACTION';
  if (Math.abs(change24h) <= 1.5) return 'CONSOLIDATION';
  return 'NEUTRAL';
}

/**
 * Synchronous accessor for the last known BTC benchmark snapshot.
 * Never performs I/O. Returns seed values (`source: 'seed'`) until
 * getBtcBenchmark() has populated the cache at least once.
 * @returns {Object} BTC benchmark snapshot
 */
function getCachedBtcBenchmark() {
  return { ...btcCache };
}

/**
 * Fetch or extract the latest live BTC benchmark metrics.
 * @param {Object} [marketDataMap] Optional pre-fetched market data map
 * @returns {Promise<Object>} BTC benchmark state
 */
async function getBtcBenchmark(marketDataMap = null) {
  const now = Date.now();
  if (now - btcCache.timestamp < CACHE_TTL_MS && btcCache.price > 0) {
    return { ...btcCache };
  }

  // Prefer BTC data already fetched into the market-data map this cycle.
  const mapBtc = marketDataMap && marketDataMap['BTC/USDT'];
  const px = mapBtc && mapBtc.price;
  if (px && typeof px.price === 'number' && px.price > 0) {
    const p = px.price;
    const change24h = typeof px.change24h === 'number' ? px.change24h : 0.0;
    const change1h = typeof px.change1h === 'number' ? px.change1h : 0.0;
    const atr = mapBtc.indicators?.atr14 || p * 0.018;

    btcCache = {
      price: p,
      change24h: round2(change24h),
      change1h: round2(change1h),
      high24h: px.high24h || p * 1.02,
      low24h: px.low24h || p * 0.98,
      volatilityAtrPct: round2((atr / p) * 100),
      trend: classifyTrend(change24h, change1h),
      timestamp: now,
      source: 'market_data_map',
    };
    return { ...btcCache };
  }

  // Cold cache with no usable map data: refresh from the network, coalescing
  // concurrent callers onto one request.
  if (!inFlightRefresh) {
    inFlightRefresh = refreshFromNetwork(now).finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

/**
 * Network refresh chain: Binance CCXT -> CoinGecko public -> last-known (stale).
 * @param {number} now Timestamp to stamp on the cache entry
 * @returns {Promise<Object>}
 */
async function refreshFromNetwork(now) {
  // Fallback 1: Binance via CCXT
  try {
    const ticker = await getBinanceClient().fetchTicker('BTC/USDT');
    if (ticker && ticker.last > 0) {
      const p = ticker.last;
      const change24h = round2(ticker.percentage || 0.0);
      btcCache = {
        price: p,
        change24h,
        change1h: 0.0,
        high24h: ticker.high || p * 1.02,
        low24h: ticker.low || p * 0.98,
        volatilityAtrPct: 1.8,
        trend: classifyTrend(change24h),
        timestamp: now,
        source: 'binance_ccxt',
      };
      return { ...btcCache };
    }
  } catch (err) {
    logger.debug(`BTC benchmark CCXT fetch notice: ${err.message}`);
  }

  // Fallback 2: CoinGecko public price endpoint
  try {
    const res = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true',
      { timeout: 3500 }
    );
    if (res.data?.bitcoin?.usd) {
      const p = res.data.bitcoin.usd;
      const change24h = round2(res.data.bitcoin.usd_24h_change || 0.0);
      btcCache = {
        price: p,
        change24h,
        change1h: 0.0,
        high24h: p * 1.02,
        low24h: p * 0.98,
        volatilityAtrPct: 1.8,
        trend: classifyTrend(change24h),
        timestamp: now,
        source: 'coingecko_public',
      };
      return { ...btcCache };
    }
  } catch (cgErr) {
    logger.debug(`BTC benchmark CoinGecko fallback notice: ${cgErr.message}`);
  }

  // Everything failed: keep serving the last snapshot, but advance the
  // timestamp so we retry on the next cache expiry rather than every call,
  // and mark the data stale so consumers can down-weight it.
  const staleSource = btcCache.source.endsWith('_stale')
    ? btcCache.source
    : `${btcCache.source}_stale`;
  btcCache = { ...btcCache, timestamp: now, source: staleSource };
  return { ...btcCache };
}

/**
 * Calculate Relative Strength (RS) of a cryptocurrency asset vs BTC.
 * RS > 0 indicates outperforming BTC (prime for Longs).
 * RS < 0 indicates underperforming BTC (avoid Longs, prime for Shorts or capital preservation).
 *
 * @param {string} symbol - e.g. 'ETH', 'SOL'
 * @param {number} assetChange24h - 24h price change % of the asset
 * @param {Object} [btcData] - Live BTC benchmark data
 * @returns {Object} Relative strength evaluation
 */
function calculateRelativeStrengthVsBtc(symbol, assetChange24h = 0.0, btcData = null) {
  const cleanSymbol = String(symbol || '').split('/')[0].toUpperCase() || 'UNKNOWN';
  if (cleanSymbol === 'BTC') {
    return {
      symbol: 'BTC',
      relativeStrengthPct: 0.0,
      classification: 'BENCHMARK',
      isOutperformingBtc: false,
      isUnderperformingBtc: false,
      score: 1.0,
      advice: 'Benchmark asset — baseline reference.',
    };
  }

  const btcChange = (btcData && typeof btcData.change24h === 'number')
    ? btcData.change24h
    : btcCache.change24h;

  const relativeStrengthPct = round2(assetChange24h - btcChange);
  const absRs = Math.abs(relativeStrengthPct);

  let classification = 'IN_LINE_WITH_BTC';
  let advice = 'Tracking in line with BTC momentum.';
  let score = 1.0;

  if (relativeStrengthPct >= 3.0) {
    classification = 'STRONG_OUTPERFORMANCE';
    advice = `High alpha momentum: ${cleanSymbol} outperforming BTC by +${absRs}%. Strong buy candidate.`;
    score = 1.35;
  } else if (relativeStrengthPct > 0.5) {
    classification = 'MODERATE_OUTPERFORMANCE';
    advice = `${cleanSymbol} slightly leading BTC (+${absRs}%). Favorable for trend continuation.`;
    score = 1.15;
  } else if (relativeStrengthPct <= -3.0) {
    classification = 'STRONG_UNDERPERFORMANCE';
    advice = `Severe laggard: ${cleanSymbol} trailing BTC by ${absRs}%. Avoid long setups; consider shorting or skip.`;
    score = 0.65;
  } else if (relativeStrengthPct < -0.5) {
    classification = 'MODERATE_UNDERPERFORMANCE';
    advice = `${cleanSymbol} lagging BTC by ${absRs}%. Lower conviction for directional longs.`;
    score = 0.85;
  }

  return {
    symbol: cleanSymbol,
    assetChange24h,
    btcChange24h: btcChange,
    relativeStrengthPct,
    classification,
    isOutperformingBtc: relativeStrengthPct > 0,
    isUnderperformingBtc: relativeStrengthPct < 0,
    score,
    advice,
  };
}

/**
 * Calculate Realized Alpha vs BTC for a single completed trade.
 * Alpha = Realized Trade PnL % - Realized BTC Return % over the same holding period.
 *
 * @param {number} entryBtcPrice - BTC price when trade was opened
 * @param {number} exitBtcPrice - BTC price when trade was closed
 * @param {number} tradePnlPct - Realized PnL % on the trade
 * @returns {Object} Alpha metrics
 */
function calculateAlphaVsBtc(entryBtcPrice, exitBtcPrice, tradePnlPct = 0.0) {
  if (!entryBtcPrice || entryBtcPrice <= 0 || !exitBtcPrice || exitBtcPrice <= 0) {
    return {
      btcReturnPct: 0.0,
      alphaVsBtcPct: round2(tradePnlPct),
      outperformedBtc: tradePnlPct > 0,
      hasBtcBenchmark: false,
    };
  }

  const btcReturnPct = round2(((exitBtcPrice - entryBtcPrice) / entryBtcPrice) * 100);
  const alphaVsBtcPct = round2(tradePnlPct - btcReturnPct);

  return {
    entryBtcPrice,
    exitBtcPrice,
    btcReturnPct,
    alphaVsBtcPct,
    outperformedBtc: alphaVsBtcPct > 0,
    hasBtcBenchmark: true,
  };
}

/**
 * Measure overall Portfolio Performance vs BTC Buy-and-Hold.
 * @param {Object}  params
 * @param {Array}   params.resolvedTrades - List of closed trades from trade ledger
 * @param {number}  params.currentPortfolioBalance - Current portfolio balance in USD
 * @param {number}  params.initialDeposit - Starting deposit in USD
 * @param {number}  params.currentBtcPrice - Current live BTC price
 * @param {number}  params.initialBtcPrice - Benchmark BTC price at system inception
 */
function calculatePortfolioBenchmarkVsBtc({
  resolvedTrades = [],
  currentPortfolioBalance = 250,
  initialDeposit = 250,
  currentBtcPrice = 68500,
  initialBtcPrice = 68500,
} = {}) {
  const portfolioPnlUsd = currentPortfolioBalance - initialDeposit;
  const portfolioRoiPct = initialDeposit > 0
    ? round2((portfolioPnlUsd / initialDeposit) * 100)
    : 0.0;

  const btcBuyHoldRoiPct = initialBtcPrice > 0
    ? round2(((currentBtcPrice - initialBtcPrice) / initialBtcPrice) * 100)
    : 0.0;

  const cumulativeAlphaPct = round2(portfolioRoiPct - btcBuyHoldRoiPct);

  // Attribution across resolved trades that carry BTC entry/exit context.
  const tradesWithBtcData = resolvedTrades.filter(t => t.btcEntryPrice && t.btcExitPrice);
  const tradesBeatingBtc = tradesWithBtcData.filter(t => (t.alphaVsBtcPct || 0) > 0).length;
  const hasBenchmarkData = tradesWithBtcData.length > 0;
  const beatBtcRatePct = hasBenchmarkData
    ? round2((tradesBeatingBtc / tradesWithBtcData.length) * 100)
    : null;

  const isBeatingBtc = cumulativeAlphaPct >= 0;
  const fmt = (n) => `${n >= 0 ? '+' : ''}${n}%`;

  return {
    portfolioBalanceUsd: currentPortfolioBalance,
    initialDepositUsd: initialDeposit,
    portfolioRoiPct,
    btcBuyHoldRoiPct,
    cumulativeAlphaPct,
    isBeatingBtc,
    totalTradesWithBenchmark: tradesWithBtcData.length,
    tradesBeatingBtc,
    beatBtcRatePct,
    statusText: isBeatingBtc
      ? `ALPHA CHAMPION: Portfolio (${fmt(portfolioRoiPct)}) is beating BTC (${fmt(btcBuyHoldRoiPct)}) by ${fmt(cumulativeAlphaPct)} Alpha.`
      : `UNDERPERFORMING BTC: Portfolio (${fmt(portfolioRoiPct)}) trails BTC (${fmt(btcBuyHoldRoiPct)}) by ${fmt(cumulativeAlphaPct)}. Risk gate adjusting.`,
  };
}

module.exports = {
  getBtcBenchmark,
  getCachedBtcBenchmark,
  classifyTrend,
  calculateRelativeStrengthVsBtc,
  calculateAlphaVsBtc,
  calculatePortfolioBenchmarkVsBtc,
};
