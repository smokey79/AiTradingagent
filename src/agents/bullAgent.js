/**
 * Bull Agent — Specialized in Long Positions & Bullish Regimes
 * =========================================================================================
 * Integrates:
 *   1. 50-EMA Institutional Trend & Dynamic Bounce
 *   2. Smart Money Concepts (SMC): LuxAlgo Order Blocks, Breakout Retests
 *   3. Exclusively hunts for LONG signals.
 */

'use strict';

const logger = require('../utils/logger');
const { calculateRelativeStrengthVsBtc, getCachedBtcBenchmark } = require('../data/btcBenchmark');
const { evaluateNegativePatterns } = require('../learning/lossLearner');
const { automateFigure } = require('./expertTraderAgent'); // Reuse the figure automation

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
    const isEmaGolden = ema20 >= ema50;
    const priceAboveEma50 = price >= ema50;

    const isOrderBlockBounce = (priceAboveEma50 && distEma50Pct >= 0 && distEma50Pct <= 2.0 && rsi >= 40 && rsi <= 70);
    const isLiquiditySweep = ind.orderBook?.bias === 'bid_heavy_bullish' || (orderBookImbalance >= 0.55 && rsi >= 35 && rsi <= 65);

    let signal = 'HOLD';
    let baseConfidence = 0.50;
    let setupType = 'No Bullish Setup';
    let reason = 'Market conditions do not favor a long entry right now.';

    // Exclusively hunt for BUY signals
    if (isEmaGolden && priceAboveEma50 && (isOrderBlockBounce || isLiquiditySweep)) {
      signal = 'BUY';
      baseConfidence = 0.85;
      setupType = 'Bullish 50-EMA SMC Bounce';
      reason = `Strong bullish bounce confirmed above 50-EMA ($${ema50.toFixed(2)}) with ${volRatio}x volume.`;

      if (rsVsBtc.isOutperformingBtc) {
        baseConfidence += 0.05;
        reason += ` Outperforming BTC by +${rsVsBtc.relativeStrengthPct}% RS.`;
      }
    } else if (priceAboveEma50 && rsi >= 50 && rsi <= 65 && volRatio >= 1.50) {
      signal = 'BUY';
      baseConfidence = 0.80;
      setupType = 'Momentum Breakout Retest';
      reason = `High-volume momentum breakout retest above 50-EMA.`;
    }

    if (signal === 'HOLD') {
      return { agent: 'bull_agent', symbol: cleanSymbol, pair, signal: 'HOLD', confidence: baseConfidence, qualityGatePassed: false, reason };
    }

    const negativePatternCheck = evaluateNegativePatterns(cleanSymbol, signal, marketData, btc);
    let finalConfidence = baseConfidence;
    if (negativePatternCheck.hasNegativePatternMatch) {
      finalConfidence = Math.max(0.40, baseConfidence - negativePatternCheck.confidencePenalty);
      reason += ` [LossLearner Alert: Adjusted -${(negativePatternCheck.confidencePenalty * 100).toFixed(0)}%]`;
    }

    const automated = automateFigure(cleanSymbol, marketData, { signal, confidence: finalConfidence });

    return {
      agent: 'bull_agent',
      symbol: cleanSymbol,
      pair,
      signal,
      confidence: finalConfidence,
      setup_type: setupType,
      timeframe: '15m',
      benchmarkVsBtc: {
        relativeStrengthPct: rsVsBtc.relativeStrengthPct,
        isOutperformingBtc: rsVsBtc.isOutperformingBtc,
      },
      indicators: { price, ema20, ema50, distEma50Pct, rsi, volumeRatio: volRatio },
      futures5x: automated.futures5x,
      sizing: automated.sizing,
      qualityGatePassed: finalConfidence >= 0.70,
      reason,
      automatedFigures: automated,
    };
  } catch (err) {
    logger.warn(`[BullAgent] Error: ${err.message}`);
    return { agent: 'bull_agent', pair, signal: 'HOLD', confidence: 0.50, qualityGatePassed: false, reason: 'Error evaluating long setup.' };
  }
}

module.exports = { getSignal };
