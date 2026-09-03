/**
 * Skill Expert Trader Agent — Chief Allocation & Crypto Strategy Officer
 * Specializes in cryptocurrency trading (BTC, ETH, SOL, altcoins, meme breakouts, 5X futures).
 * Automatically calculates all figures: 50-EMA positioning, Half-Kelly sizing,
 * 5X leverage presets, liquidation buffers, stop-loss, and take-profit targets.
 */
const logger = require('../utils/logger');
const { getPortfolioState, calculateProportionateAllocation, getAllocationSettings } = require('../risk/riskGate');

/**
 * Automate All Trading Figures for a Crypto Setup
 * @param {string} symbol - e.g. 'BTC'
 * @param {Object} marketData - Price, candles, indicators
 * @param {Object} consensus - Master consensus signal & confidence
 * @param {number} accountBalance - Account equity in USD
 */
function automateFigure(symbol, marketData = {}, consensus = {}, accountBalance = 250) {
  const price = marketData?.price?.price || 100;
  const ind = marketData?.indicators || {};
  const ema50 = ind.ema50 || (ind.priceVsEma50 === 'above' ? price * 0.98 : price * 1.02);
  const ema20 = ind.ema20 || price;
  const atr = ind.atr14 || price * 0.02;
  const confidence = consensus?.confidence || 0.75;
  const signal = consensus?.signal || 'BUY';

  // 1. 50-EMA Distance and Trend Analysis
  const distEma50Pct = parseFloat((((price - ema50) / ema50) * 100).toFixed(2));
  const isEmaGolden = ema20 >= ema50;

  // 2. Automated Sizing: 10% standard position bounded between $10 and $30
  const baseAllocationPct = 10.0;
  const confidenceScale = Math.max(0.8, Math.min(1.2, confidence / 0.75));
  const effectivePct = parseFloat((baseAllocationPct * confidenceScale).toFixed(1));
  const positionSizeUsd = parseFloat(Math.max(10.0, Math.min(30.0, (accountBalance * effectivePct) / 100)).toFixed(2));
  const tokenAmount = parseFloat((positionSizeUsd / price).toFixed(6));

  // 3. Automated 5X Leverage Preset
  const leverage = 5.0;
  const effectiveExposureUsd = parseFloat((positionSizeUsd * leverage).toFixed(2));
  const liquidationBufferPct = 18.2; // 18.2% liquidation distance on 5X isolated margin

  // 4. Automated Stop-Loss & Take-Profit Figures
  const atrStopPct = parseFloat(((atr * 1.5 / price) * 100).toFixed(2));
  const stopLossPct = Math.max(1.5, Math.min(3.5, atrStopPct || 2.0));
  const takeProfitPct = parseFloat((stopLossPct * 2.2).toFixed(2));

  const stopLossPrice = signal === 'BUY'
    ? parseFloat((price * (1 - stopLossPct / 100)).toFixed(4))
    : parseFloat((price * (1 + stopLossPct / 100)).toFixed(4));

  const takeProfitPrice = signal === 'BUY'
    ? parseFloat((price * (1 + takeProfitPct / 100)).toFixed(4))
    : parseFloat((price * (1 - takeProfitPct / 100)).toFixed(4));

  const expectedProfitUsd = parseFloat(((takeProfitPct / 100) * effectiveExposureUsd).toFixed(2));
  const maxRiskUsd = parseFloat(((stopLossPct / 100) * effectiveExposureUsd).toFixed(2));

  return {
    symbol,
    assetClass: 'CRYPTOCURRENCY',
    currentPrice: price,
    ema50: {
      value: ema50,
      priceVsEma50: price >= ema50 ? 'ABOVE' : 'BELOW',
      distancePct: distEma50Pct,
      goldenAlignment: isEmaGolden,
    },
    sizing: {
      accountBalance,
      allocationPct: effectivePct,
      positionSizeUsd,
      tokenAmount,
    },
    futures5x: {
      leverage,
      effectiveExposureUsd,
      liquidationBufferPct,
      stopLossPct,
      stopLossPrice,
      takeProfitPct,
      takeProfitPrice,
      riskRewardRatio: 2.2,
      expectedProfitUsd,
      maxRiskUsd,
      roiTargetOnCollateralPct: parseFloat((takeProfitPct * leverage).toFixed(1)),
      maxCollateralLossPct: parseFloat((stopLossPct * leverage).toFixed(1)),
    },
    qualityGatePassed: confidence >= 0.68,
  };
}

/**
 * Evaluate Trade Setup and Output Proportionate Allocation
 */
async function assessAllocation(symbol, marketData = {}, consensus = {}, options = {}) {
  const state = getPortfolioState();
  const settings = getAllocationSettings();
  const price = marketData?.price?.price || 0;
  const change24h = marketData?.price?.change24h || 0;
  const rsi = marketData?.indicators?.rsi14 || 50;
  const volRatio = marketData?.indicators?.volumeRatio || 1.0;
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
    regimeMultiplier = 0.85;
  }

  // 2. Determine Asset Type
  const isMemeCoin = options.isMemeCoin || ['DOGE', 'SHIB', 'PEPE', 'BONK', 'WIF', 'FLOKI', 'BRETT', 'POPCAT'].includes(symbol.toUpperCase());

  // 3. Automate Figures
  const automated = automateFigure(symbol, marketData, consensus, state.currentBalance);

  // 4. Calculate Proportionate Sizing in Base Currency
  const allocation = calculateProportionateAllocation({
    balance: state.currentBalance,
    baseCurrency: options.baseCurrency || settings.baseCurrency,
    overridePct: options.overridePct !== undefined ? options.overridePct : settings.overrideAllocationPct,
    isMemeCoin,
    confidence: confidence * regimeMultiplier,
  });

  const assessment = {
    agent: 'expert_trader',
    timestamp: new Date().toISOString(),
    symbol,
    specialization: 'Cryptocurrency & 5X Perpetual Futures',
    marketRegime: regime,
    isMemeCoin,
    baseCurrency: allocation.baseCurrency,
    accountTotalBalance: allocation.totalBalanceInCurrency,
    allocationPct: allocation.effectiveAllocationPct,
    allocatedPositionSize: allocation.positionSizeInCurrency,
    allocatedPositionSizeUsd: allocation.positionSizeUsd,
    automatedFigures: automated,
    rationale: `Expert Crypto Trader: Allocated ${allocation.effectiveAllocationPct}% ($${allocation.positionSizeUsd} USD) in ${regime} regime with ${(confidence * 100).toFixed(0)}% conviction. 50-EMA anchor at $${automated.ema50.value.toFixed(2)} (${automated.ema50.distancePct}% dist).`,
    isOverrideApplied: allocation.isOverrideActive,
  };

  logger.info(`🧠 [Expert Trader] Automated figures for ${symbol}: $${assessment.allocatedPositionSizeUsd} USD position | 50-EMA: $${automated.ema50.value.toFixed(2)} | SL: $${automated.futures5x.stopLossPrice} | TP: $${automated.futures5x.takeProfitPrice}`);
  return assessment;
}

module.exports = {
  assessAllocation,
  automateFigure,
};
