/**
 * Bear Agent — Specialized in Short Positions & Bearish Regimes
 * =========================================================================================
 * Integrates:
 *   1. 50-EMA Institutional Trend & Dynamic Rejection
 *   2. Smart Money Concepts (SMC): Breakdowns, Bearish Order Blocks
 *   3. Exclusively hunts for SELL (Short) signals.
 */

'use strict';

const logger = require('../utils/logger');
const { calculateRelativeStrengthVsBtc, getCachedBtcBenchmark } = require('../data/btcBenchmark');
const { evaluateNegativePatterns } = require('../learning/lossLearner');
const { automateFigure } = require('./expertTraderAgent'); 

async function getSignal(symbol, marketData = {}, btcContext = null) {
  const cleanSymbol = symbol.split('/')[0].toUpperCase();
  const pair = symbol.includes('/') ? symbol.toUpperCase() : `${cleanSymbol}/USDT`;

  try {
    const price = marketData?.price?.price || 100.0;
    const change24h = marketData?.price?.change24h || 0.0;
    const ind = marketData?.indicators || {};

    const ema20 = ind.ema20 || price;
    const ema50 = ind.ema50 || (ind.priceVsEma50 === 'above' ? price * 0.98 : price * 1.02);
    const rsi = ind.rsi14 || 50.0;
    const volRatio = ind.volumeRatio || 1.0;
    const orderBookImbalance = ind.orderBook?.imbalanceRatio || 0.5;

    const btc = btcContext || marketData?.btcBenchmark || getCachedBtcBenchmark();
    const rsVsBtc = calculateRelativeStrengthVsBtc(cleanSymbol, change24h, btc);

    const distEma50Pct = parseFloat((((price - ema50) / ema50) * 100).toFixed(2));
    const isEmaDeathCross = ema20 <= ema50;
    const priceBelowEma50 = price <= ema50;

    const isOrderBlockRejection = (priceBelowEma50 && distEma50Pct <= 0 && distEma50Pct >= -2.0 && rsi >= 30 && rsi <= 60);
    const isLiquiditySweep = ind.orderBook?.bias === 'ask_heavy_bearish' || (orderBookImbalance <= 0.45 && rsi >= 35 && rsi <= 65);

    let signal = 'HOLD';
    let baseConfidence = 0.50;
    let setupType = 'No Bearish Setup';
    let reason = 'Market conditions do not favor a short entry right now.';

    // Exclusively hunt for SELL signals
    if (isEmaDeathCross && priceBelowEma50 && (isOrderBlockRejection || isLiquiditySweep)) {
      signal = 'SELL';
      baseConfidence = 0.85;
      setupType = 'Bearish 50-EMA Dynamic Rejection';
      reason = `Strong bearish rejection confirmed below 50-EMA ($${ema50.toFixed(2)}) with ${volRatio}x volume.`;

      if (rsVsBtc.isUnderperformingBtc) {
        baseConfidence += 0.05;
        reason += ` Lagging BTC by ${rsVsBtc.relativeStrengthPct}% RS.`;
      }
    } else if (priceBelowEma50 && rsi <= 50 && rsi >= 35 && volRatio >= 1.50) {
      signal = 'SELL';
      baseConfidence = 0.80;
      setupType = 'Momentum Breakdown Retest';
      reason = `High-volume momentum breakdown retest below 50-EMA.`;
    }

    if (signal === 'HOLD') {
      return { agent: 'bear_agent', symbol: cleanSymbol, pair, signal: 'HOLD', confidence: baseConfidence, qualityGatePassed: false, reason };
    }

    const negativePatternCheck = evaluateNegativePatterns(cleanSymbol, signal, marketData, btc);
    let finalConfidence = baseConfidence;
    if (negativePatternCheck.hasNegativePatternMatch) {
      finalConfidence = Math.max(0.40, baseConfidence - negativePatternCheck.confidencePenalty);
      reason += ` [LossLearner Alert: Adjusted -${(negativePatternCheck.confidencePenalty * 100).toFixed(0)}%]`;
    }

    const automated = automateFigure(cleanSymbol, marketData, { signal, confidence: finalConfidence });

    return {
      agent: 'bear_agent',
      symbol: cleanSymbol,
      pair,
      signal,
      confidence: finalConfidence,
      setup_type: setupType,
      timeframe: '15m',
      benchmarkVsBtc: {
        relativeStrengthPct: rsVsBtc.relativeStrengthPct,
        isUnderperformingBtc: rsVsBtc.isUnderperformingBtc,
      },
      indicators: { price, ema20, ema50, distEma50Pct, rsi, volumeRatio: volRatio },
      futures5x: automated.futures5x,
      sizing: automated.sizing,
      qualityGatePassed: finalConfidence >= 0.70,
      reason,
      automatedFigures: automated,
    };
  } catch (err) {
    logger.warn(`[BearAgent] Error: ${err.message}`);
    return { agent: 'bear_agent', pair, signal: 'HOLD', confidence: 0.50, qualityGatePassed: false, reason: 'Error evaluating short setup.' };
  }
}

module.exports = { getSignal };
