/**
 * Market Regime Classifier Engine
 * Determines the current market regime based on macro flows, volatility, and technical alignment.
 */

const logger = require('../utils/logger');

const REGIMES = {
  STRONG_BULL_TREND: 'STRONG_BULL_TREND',
  STRONG_BEAR_TREND: 'STRONG_BEAR_TREND',
  CHOPPY_RANGING: 'CHOPPY_RANGING',
  HIGH_VOLATILITY_EXPANSION: 'HIGH_VOLATILITY_EXPANSION',
};

// Simple cached state for the 1-hour schedule (though currently just computed on-demand)
let cachedRegime = null;
let lastUpdate = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Classifies market regime from aggregated market data.
 * @param {Object} marketData Aggregated data including BTC baseline, macro, and indicators
 * @returns {string} The detected regime
 */
function classifyRegime(marketData = {}) {
  const now = Date.now();
  if (cachedRegime && (now - lastUpdate < CACHE_TTL_MS)) {
    return cachedRegime;
  }

  // 1. Technical Baseline (BTC Trend)
  const btcBenchmark = marketData.btcBenchmark || {};
  const isBtcBullish = btcBenchmark.trend === 'STRONG_BULLISH' || btcBenchmark.trend === 'BULLISH';
  const isBtcBearish = btcBenchmark.trend === 'STRONG_BEARISH' || btcBenchmark.trend === 'BEARISH';
  const isBtcChoppy = !isBtcBullish && !isBtcBearish;

  // 2. Macro Flows (ETF data)
  const macro = marketData.macro || {};
  const isMacroBullish = macro.macro_signal === 'bullish_strong_inflow' || macro.macro_signal === 'bullish_moderate_inflow';
  const isMacroBearish = macro.macro_signal === 'bearish_strong_outflow' || macro.macro_signal === 'bearish_moderate_outflow';

  // 3. Volatility / ATR (optional if available)
  const indicators = marketData.indicators || {};
  const atr = indicators.atr14 || 0;
  const price = marketData.price?.price || 1;
  const atrPct = (atr / price) * 100;
  const isHighVol = atrPct > 4.0; // E.g., > 4% ATR on 15m/1h is very high volatility

  // 4. Decision Tree
  let regime = REGIMES.CHOPPY_RANGING;

  if (isHighVol) {
    regime = REGIMES.HIGH_VOLATILITY_EXPANSION;
  } else if (isBtcBullish && isMacroBullish) {
    regime = REGIMES.STRONG_BULL_TREND;
  } else if (isBtcBearish && isMacroBearish) {
    regime = REGIMES.STRONG_BEAR_TREND;
  } else if (isBtcBullish || isMacroBullish) {
    // Weak bull is still trend if volatility is normal
    regime = REGIMES.STRONG_BULL_TREND;
  } else if (isBtcBearish || isMacroBearish) {
    regime = REGIMES.STRONG_BEAR_TREND;
  } else {
    regime = REGIMES.CHOPPY_RANGING;
  }

  // Fallback to choppy if completely conflicting
  if (isBtcBullish && isMacroBearish) regime = REGIMES.CHOPPY_RANGING;
  if (isBtcBearish && isMacroBullish) regime = REGIMES.CHOPPY_RANGING;

  // Cache and return
  cachedRegime = regime;
  lastUpdate = now;

  logger.info(`🌐 Market Regime Classified: ${regime}`);
  return regime;
}

function getCachedRegime() {
  return cachedRegime || REGIMES.CHOPPY_RANGING;
}

module.exports = {
  REGIMES,
  classifyRegime,
  getCachedRegime,
};
