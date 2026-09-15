/**
 * Skill Expert Trader Agent — Chief Allocation & Strategy Officer
 * Assesses market regime, technical confluence, and calculates exact capital allocation
 * in proportion to total account equity in GBPX / USDP / USDT / USD.
 */
const logger = require('../utils/logger');
const { getPortfolioState, calculateProportionateAllocation, getAllocationSettings } = require('../risk/riskGate');

/**
 * Evaluate Trade Setup and Output Proportionate Allocation
 * @param {string} symbol - e.g. 'BTC'
 * @param {Object} marketData - Market indicators & candles
 * @param {Object} consensus - Master AI consensus signal
 * @param {Object} options - Override parameters
 */
async function assessAllocation(symbol, marketData = {}, consensus = {}, options = {}) {
  const state = getPortfolioState();
  const settings = getAllocationSettings();

  const price = marketData?.price?.price || 0;
  const change24h = marketData?.price?.change24h || 0;
  const rsi = marketData?.indicators?.rsi14 || 50;
  const volRatio = marketData?.indicators?.volumeRatio || 1.0;
  const signal = consensus?.signal || 'BUY';
  const confidence = consensus?.confidence || 0.85;

  // 1. Determine Market Regime
  let regime = 'RANGE_BOUND';
  let regimeMultiplier = 1.0;

  if (volRatio > 1.6 && Math.abs(change24h) > 3.0) {
    regime = 'HIGH_MOMENTUM_BREAKOUT';
    regimeMultiplier = 1.15;
  } else if (rsi > 45 && rsi < 65 && Math.abs(change24h) < 2.0) {
    regime = 'CONSTRUCTIVE_ACCUMULATION';
    regimeMultiplier = 1.0;
  } else if (rsi < 30 || rsi > 70) {
    regime = 'OVEREXTENDED_MEAN_REVERSION';
    regimeMultiplier = 0.85; // Reduce sizing when overextended
  }

  // 2. Determine Asset Type (Meme Coin vs Layer 1/DeFi Major)
  const isMemeCoin = options.isMemeCoin || ['DOGE', 'SHIB', 'PEPE', 'BONK', 'WIF', 'FLOKI', 'BRETT', 'POPCAT'].includes(symbol.toUpperCase());

  // 3. Calculate Proportionate Sizing in Base Currency
  const allocation = calculateProportionateAllocation({
    balance: state.currentBalance,
    baseCurrency: options.baseCurrency || settings.baseCurrency,
    overridePct: options.overridePct !== undefined ? options.overridePct : settings.overrideAllocationPct,
    isMemeCoin,
    confidence: confidence * regimeMultiplier,
  });

  // 4. Volatility Stop-Loss and Take-Profit bounds
  const stopLossPct = Math.max(1.5, Math.min(4.0, (marketData?.indicators?.atr14 ? (marketData.indicators.atr14 / price) * 100 * 1.2 : 2.0)));
  const takeProfitPct = parseFloat((stopLossPct * 2.2).toFixed(2));

  const assessment = {
    agent: 'expert_trader',
    timestamp: new Date().toISOString(),
    symbol,
    marketRegime: regime,
    isMemeCoin,
    baseCurrency: allocation.baseCurrency,
    accountTotalBalance: allocation.totalBalanceInCurrency,
    allocationPct: allocation.effectiveAllocationPct,
    allocatedPositionSize: allocation.positionSizeInCurrency,
    allocatedPositionSizeUsd: allocation.positionSizeUsd,
    recommendedLeverage: 1.0,
    stopLossPct,
    takeProfitPct,
    riskRewardRatio: 2.2,
    rationale: `Expert Trader sizing: Allocated ${allocation.effectiveAllocationPct}% of account (${allocation.positionSizeInCurrency} ${allocation.baseCurrency} / $${allocation.positionSizeUsd} USD) based on ${regime} regime with ${(confidence * 100).toFixed(0)}% conviction.`,
    isOverrideApplied: allocation.isOverrideActive,
  };

  logger.info(`🧠 [Expert Trader] Sizing for ${symbol}: ${assessment.allocatedPositionSize} ${assessment.baseCurrency} ($${assessment.allocatedPositionSizeUsd} USD) -> ${regime}`);
  return assessment;
}

module.exports = {
  assessAllocation,
};
