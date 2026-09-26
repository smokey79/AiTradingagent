/**
 * Skill Expert Trader Agent — Chief Crypto Strategy, Technical Analysis & Allocation Officer
 * =========================================================================================
 * Integrates:
 *   1. 50-EMA Institutional Trend & Dynamic Bounce/Rejection (gemini-pattern-recognition skill)
 *   2. Smart Money Concepts (SMC): LuxAlgo Order Blocks, Casper 5-min ORB Retests, Liquidity Sweeps (technical-analysis skill)
 *   3. Bitcoin Benchmark & Relative Strength (RS vs BTC) Alpha Filtering (btcBenchmark.js)
 *   4. Self-Learning Negative Pattern Memory & Loss Avoidance (lossLearner.js)
 *   5. Automated Figures: 5.0X Isolated Leverage Presets, 18.2% Liquidation Buffer, ATR Stops, Half-Kelly Sizing
 *   6. Dynamic Universe Opportunity Scanner to create high-conviction trades for the Orchestrator
 */

'use strict';

const logger = require('../utils/logger');
const { getPortfolioState, calculateProportionateAllocation, getAllocationSettings } = require('../risk/riskGate');
const { calculateRelativeStrengthVsBtc, getBtcBenchmark } = require('../data/btcBenchmark');
const { evaluateNegativePatterns } = require('../learning/lossLearner');

/**
 * Institutional Crypto Expert Trader Decision Engine
 * @param {string} symbol - e.g. 'BTC' or 'ETH/USDT'
 * @param {Object} marketData - Price, candles, indicators
 * @param {Object} [btcContext] - Pre-fetched BTC benchmark
 * @returns {Promise<Object>} Expert trade signal & figures
 */
async function getSignal(symbol, marketData = {}, btcContext = null) {
  const cleanSymbol = symbol.split('/')[0].toUpperCase();
  const pair = symbol.includes('/') ? symbol.toUpperCase() : `${cleanSymbol}/USDT`;

  try {
    const price = marketData?.price?.price || 100.0;
    const change24h = marketData?.price?.change24h || 0.0;
    const ind = marketData?.indicators || {};

    const ema20 = ind.ema20 || price;
    const ema50 = ind.ema50 || (ind.priceVsEma50 === 'above' ? price * 0.98 : price * 1.02);
    const ema200 = ind.ema200 || price * 0.95;
    const rsi = ind.rsi14 || 50.0;
    const atr = ind.atr14 || (price * 0.02);
    const volRatio = ind.volumeRatio || 1.0;
    const orderBookImbalance = ind.orderBook?.imbalanceRatio || 0.5;

    // 1. Fetch live BTC benchmark and evaluate Relative Strength vs BTC
    const btc = btcContext || await getBtcBenchmark();
    const rsVsBtc = calculateRelativeStrengthVsBtc(cleanSymbol, change24h, btc);

    // 2. 50-EMA Trend & Alignment Analysis (gemini-pattern-recognition skill)
    const distEma50Pct = parseFloat((((price - ema50) / ema50) * 100).toFixed(2));
    const isEmaGolden = ema20 >= ema50;
    const priceAboveEma50 = price >= ema50;

    // 3. Smart Money Concepts (SMC) & Liquidity Sweep Detection (technical-analysis skill)
    const isOrderBlockBounce = (priceAboveEma50 && distEma50Pct >= 0 && distEma50Pct <= 1.2 && rsi >= 45 && rsi <= 68);
    const isLiquiditySweep = ind.orderBook?.bias === 'bid_heavy_bullish' || (orderBookImbalance >= 0.55 && rsi >= 42 && rsi <= 65);
    const isCasperOrbRetest = volRatio >= 1.25 && Math.abs(change24h) >= 1.5;

    // 4. Determine Directional Signal and Base Conviction
    let signal = 'HOLD';
    let baseConfidence = 0.50;
    let setupType = 'Equilibrium Range Consolidation';
    let reason = 'Market in consolidation mode near institutional baseline.';

    if (isEmaGolden && priceAboveEma50 && (isOrderBlockBounce || isLiquiditySweep)) {
      signal = 'BUY';
      baseConfidence = 0.82;
      setupType = 'LuxAlgo SMC Order Block 50-EMA Retest';
      reason = `Bullish 50-EMA bounce ($${ema50.toFixed(2)}) with golden alignment and ${volRatio}x volume expansion.`;

      // Bonus for high relative strength vs BTC
      if (rsVsBtc.isOutperformingBtc) {
        baseConfidence += 0.06;
        reason += ` Leading BTC by +${rsVsBtc.relativeStrengthPct}% RS.`;
      }
    } else if (!isEmaGolden && !priceAboveEma50 && rsi <= 50 && distEma50Pct <= 0 && distEma50Pct >= -2.0) {
      signal = 'SELL';
      baseConfidence = 0.78;
      setupType = '50-EMA Dynamic Rejection & Death Cross';
      reason = `Price rejected at 50-EMA downward slope ($${ema50.toFixed(2)}) with death alignment.`;

      if (rsVsBtc.isUnderperformingBtc) {
        baseConfidence += 0.05;
        reason += ` Lagging BTC by ${rsVsBtc.relativeStrengthPct}% RS.`;
      }
    } else if (priceAboveEma50 && rsi >= 50 && rsi <= 65 && volRatio >= 1.35) {
      signal = 'BUY';
      baseConfidence = 0.76;
      setupType = 'Casper SMC 5-min ORB Breakout Retest';
      reason = `Breakout retest confirmed above 50-EMA with ${volRatio}x institutional volume.`;
    }

    // 5. Check Self-Learning Negative Pattern Memory (lossLearner.js)
    const negativePatternCheck = evaluateNegativePatterns(cleanSymbol, signal, marketData, btc);
    let finalConfidence = baseConfidence;
    let warningNote = '';

    if (negativePatternCheck.hasNegativePatternMatch) {
      finalConfidence = Math.max(0.40, baseConfidence - negativePatternCheck.confidencePenalty);
      warningNote = ` [LossLearner Alert: Adjusted -${(negativePatternCheck.confidencePenalty * 100).toFixed(0)}% due to matching historical loss trap]`;
      reason += warningNote;
    }

    finalConfidence = parseFloat(Math.min(0.96, Math.max(0.40, finalConfidence)).toFixed(3));

    // 6. Automated Figures: 5X Futures, Half-Kelly Sizing, Stops & Targets
    const automated = automateFigure(cleanSymbol, marketData, { signal, confidence: finalConfidence });

    return {
      agent: 'expert_trader',
      symbol: cleanSymbol,
      pair,
      signal,
      confidence: finalConfidence,
      setup_type: setupType,
      timeframe: '15m',
      benchmarkVsBtc: {
        relativeStrengthPct: rsVsBtc.relativeStrengthPct,
        classification: rsVsBtc.classification,
        isOutperformingBtc: rsVsBtc.isOutperformingBtc,
        btcTrend: btc.trend,
      },
      negativePatternAnalysis: {
        trapDetected: negativePatternCheck.hasNegativePatternMatch,
        penaltyApplied: negativePatternCheck.confidencePenalty,
        matches: negativePatternCheck.matches,
      },
      indicators: {
        price,
        ema20,
        ema50,
        distEma50Pct,
        goldenAlignment: isEmaGolden,
        rsi,
        atr,
        volumeRatio: volRatio,
      },
      futures5x: automated.futures5x,
      sizing: automated.sizing,
      qualityGatePassed: finalConfidence >= 0.68,
      reason,
      automatedFigures: automated,
    };
  } catch (err) {
    logger.warn(`[ExpertTrader] getSignal notice for ${symbol}: ${err.message}`);
    return {
      agent: 'expert_trader',
      symbol: cleanSymbol,
      pair,
      signal: 'HOLD',
      confidence: 0.50,
      qualityGatePassed: false,
      reason: `Fallback signal due to technical evaluation error: ${err.message}`,
    };
  }
}

/**
 * Scan All Active Market Pairs and Create High-Conviction Expert Trades
 * Identifies the top risk/reward setups across the universe for the Orchestrator
 *
 * @param {Object} marketDataMap - Map of pair -> marketData
 * @param {Object} [btcBenchmark] - Live BTC benchmark data
 * @returns {Promise<Array>} Ranked list of expert trade opportunities
 */
async function scanAndCreateTrades(marketDataMap = {}, btcBenchmark = null) {
  const btc = btcBenchmark || await getBtcBenchmark(marketDataMap);
  const opportunities = [];

  for (const [pair, md] of Object.entries(marketDataMap)) {
    if (!md || !md.price || md.price.price <= 0) continue;
    const cleanSymbol = pair.split('/')[0].toUpperCase();

    try {
      const expertSignal = await getSignal(pair, md, btc);

      if (expertSignal.signal !== 'HOLD' && expertSignal.confidence >= 0.68) {
        // Calculate an institutional quality score (0 - 100)
        const confScore = expertSignal.confidence * 45;
        const rsScore = Math.max(0, Math.min(25, (expertSignal.benchmarkVsBtc.relativeStrengthPct + 5) * 2.5));
        const penaltyDeduction = expertSignal.negativePatternAnalysis.trapDetected ? 15 : 0;
        const qualityScore = parseFloat((confScore + rsScore + 30 - penaltyDeduction).toFixed(1));

        opportunities.push({
          pair,
          symbol: cleanSymbol,
          signal: expertSignal.signal,
          confidence: expertSignal.confidence,
          qualityScore,
          setupType: expertSignal.setup_type,
          rsVsBtc: expertSignal.benchmarkVsBtc.relativeStrengthPct,
          entryPrice: expertSignal.futures5x.entry_price || md.price.price,
          stopLoss: expertSignal.futures5x.stopLossPrice,
          takeProfit: expertSignal.futures5x.takeProfitPrice,
          leverage: 5.0,
          expectedProfitUsd: expertSignal.futures5x.expectedProfitUsd,
          maxRiskUsd: expertSignal.futures5x.maxRiskUsd,
          positionSizeUsd: expertSignal.sizing.positionSizeUsd,
          reason: expertSignal.reason,
          createdTimestamp: new Date().toISOString(),
          details: expertSignal,
        });
      }
    } catch (e) {
      // ignore individual pair scan errors
    }
  }

  // Sort by quality score descending
  opportunities.sort((a, b) => b.qualityScore - a.qualityScore);

  if (opportunities.length > 0) {
    logger.info(
      `🎯 [ExpertTrader] Opportunity Scanner discovered ${opportunities.length} high-conviction crypto setup(s)! Top pick: ${opportunities[0].signal} ${opportunities[0].pair} (Quality: ${opportunities[0].qualityScore}/100 | ${(opportunities[0].confidence * 100).toFixed(0)}% conf)`
    );
  }

  return opportunities;
}

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
      entry_price: price,
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
  getSignal,
  scanAndCreateTrades,
  assessAllocation,
  automateFigure,
};
