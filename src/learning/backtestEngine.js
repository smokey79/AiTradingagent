/**
 * Backtesting Engine for Multi-Factor & Smart Money Concepts (SMC) Strategies
 * Simulates high-fidelity trade execution on historical multi-timeframe OHLCV data.
 * Computes institutional performance metrics: Win Rate, Sharpe Ratio, Sortino Ratio,
 * Profit Factor, Maximum Drawdown, Kelly Criterion Sizing, and 68% Gate Compliance.
 */

'use strict';

const ccxt = require('ccxt');
const logger = require('../utils/logger');
const {
  calculateRSI,
  calculateEMA,
  calculateATR,
} = require('../data/indicators');

let _ccxtExchange = null;
function getExchange() {
  if (!_ccxtExchange) {
    _ccxtExchange = new ccxt.binance({
      enableRateLimit: true,
      timeout: 8000,
    });
  }
  return _ccxtExchange;
}

/**
 * Generate synthetic OHLCV candles when offline or testing
 */
function generateSyntheticCandles(basePrice = 77000, count = 250, timeframe = '15m') {
  const candles = [];
  let price = basePrice;
  const now = Date.now();
  const tfMs = timeframe.endsWith('h') ? parseInt(timeframe) * 3600000 : parseInt(timeframe) * 60000;

  for (let i = count; i >= 1; i--) {
    const ts = now - i * tfMs;
    const trendDrift = (Math.random() - 0.47) * (price * 0.0035);
    const open = price;
    const close = Math.max(open + trendDrift, 0.01);
    const high = Math.max(open, close) + Math.random() * (price * 0.002);
    const low = Math.min(open, close) - Math.random() * (price * 0.002);
    const volume = Math.floor(Math.random() * 500000 + 100000);
    candles.push([ts, open, high, low, close, volume]);
    price = close;
  }
  return candles;
}

/**
 * Fetch historical OHLCV data via CCXT
 */
async function fetchHistoricalCandles(symbol = 'BTC/USDT', timeframe = '15m', limit = 300) {
  const pair = symbol.includes('/') ? symbol.toUpperCase() : `${symbol.toUpperCase()}/USDT`;
  try {
    const exchange = getExchange();
    const data = await exchange.fetchOHLCV(pair, timeframe, undefined, limit);
    if (data && data.length >= 30) {
      return data;
    }
  } catch (err) {
    logger.debug(`[BacktestEngine] CCXT fetch failed for ${pair}: ${err.message}. Using synthetic candles.`);
  }
  return generateSyntheticCandles(77000, limit, timeframe);
}

/**
 * Calculate Money Flow Index (MFI)
 */
function calculateMFI(highs, lows, closes, volumes, period = 14) {
  if (!closes || closes.length < period + 1) return Array(closes.length).fill(50.0);
  const typicalPrices = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const rawMoneyFlow = typicalPrices.map((tp, i) => tp * volumes[i]);
  const mfi = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      mfi.push(50.0);
      continue;
    }
    let posFlow = 0;
    let negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (typicalPrices[j] > typicalPrices[j - 1]) posFlow += rawMoneyFlow[j];
      else if (typicalPrices[j] < typicalPrices[j - 1]) negFlow += rawMoneyFlow[j];
    }
    const moneyRatio = negFlow === 0 ? 100 : posFlow / negFlow;
    const mfiVal = 100 - 100 / (1 + moneyRatio);
    mfi.push(parseFloat(mfiVal.toFixed(2)));
  }
  return mfi;
}

/**
 * Core Backtest Simulation Function
 */
function runBacktestSimulation({
  candles,
  strategyType = 'smc_luxalgo_5x',
  params = {},
  initialCapital = 1000,
  positionSizePct = 20, // 20% of capital per trade
  leverage = 5.0,
  slippagePct = 0.05,
  commissionPct = 0.05,
}) {
  if (!candles || candles.length < 50) {
    throw new Error('Insufficient candle data for backtest (minimum 50 candles required)');
  }

  const timestamps = candles.map(c => c[0]);
  const opens = candles.map(c => c[1]);
  const highs = candles.map(c => c[2]);
  const lows = candles.map(c => c[3]);
  const closes = candles.map(c => c[4]);
  const volumes = candles.map(c => c[5]);
  const len = candles.length;

  // Hyperparameters with defaults
  const obLookback = params.obLookback || 10;
  const rsiLength = params.rsiLength || 14;
  const rsiLongMin = params.rsiLongMin || 45;
  const rsiLongMax = params.rsiLongMax || 68;
  const rsiShortMin = params.rsiShortMin || 32;
  const rsiShortMax = params.rsiShortMax || 55;
  const mfiLength = params.mfiLength || 14;
  const volMultiplier = params.volMultiplier || 1.45;
  const tpPct = params.takeProfitPct || 4.0;
  const slPct = params.stopLossPct || 1.5;
  const atrLength = params.atrLength || 14;
  const atrMultiplier = params.atrMultiplier || 1.5;
  const useTrailing = params.useTrailingStop !== false;

  // Precompute indicator series
  const rsiSeries = [];
  for (let i = 0; i < len; i++) {
    rsiSeries.push(i >= rsiLength ? calculateRSI(closes.slice(0, i + 1), rsiLength) : 50.0);
  }
  const mfiSeries = calculateMFI(highs, lows, closes, volumes, mfiLength);

  const ema20Series = [];
  const ema50Series = [];
  for (let i = 0; i < len; i++) {
    ema20Series.push(i >= 20 ? calculateEMA(closes.slice(0, i + 1), 20) : closes[i]);
    ema50Series.push(i >= 50 ? calculateEMA(closes.slice(0, i + 1), 50) : closes[i]);
  }

  // Precompute ATR series
  const atrSeries = [];
  for (let i = 0; i < len; i++) {
    if (i < atrLength + 1) {
      atrSeries.push(closes[i] * 0.015);
    } else {
      atrSeries.push(calculateATR(highs.slice(0, i + 1), lows.slice(0, i + 1), closes.slice(0, i + 1), atrLength));
    }
  }

  // Simulation state
  let capital = initialCapital;
  let peakCapital = initialCapital;
  let maxDrawdownUsd = 0;
  let maxDrawdownPct = 0;

  const trades = [];
  let activePosition = null; // { side, entryPrice, entryTime, sizeUsd, collateralUsd, sl, tp, trailingSl, entryBar }

  // Bar-by-bar walk forward
  const startBar = Math.max(50, obLookback + 5);

  for (let i = startBar; i < len; i++) {
    const currentPrice = closes[i];
    const currentHigh = highs[i];
    const currentLow = lows[i];
    const currentVolume = volumes[i];
    const currentTs = timestamps[i];

    // Compute volume SMA
    const volSlice = volumes.slice(Math.max(0, i - 20), i);
    const avgVol = volSlice.reduce((a, b) => a + b, 0) / volSlice.length;
    const volSurge = currentVolume > avgVol * volMultiplier;

    // Check active position for exit triggers
    if (activePosition) {
      const { side, entryPrice, collateralUsd, sizeUsd, tp, entryBar } = activePosition;
      let exitPrice = null;
      let exitReason = null;

      // Update trailing stop
      if (useTrailing) {
        const atr = atrSeries[i];
        if (side === 'BUY') {
          activePosition.trailingSl = Math.max(activePosition.trailingSl, currentPrice - (atr * atrMultiplier));
        } else {
          activePosition.trailingSl = Math.min(activePosition.trailingSl, currentPrice + (atr * atrMultiplier));
        }
      }

      const effectiveSl = useTrailing ? activePosition.trailingSl : activePosition.sl;

      if (side === 'BUY') {
        if (currentHigh >= tp) {
          exitPrice = tp;
          exitReason = 'TAKE_PROFIT';
        } else if (currentLow <= effectiveSl) {
          exitPrice = effectiveSl;
          exitReason = 'STOP_LOSS';
        } else if (currentLow <= entryPrice * (1 - 0.175)) { // 5X liquidation threshold
          exitPrice = entryPrice * (1 - 0.175);
          exitReason = 'LIQUIDATION';
        }
      } else { // SELL / SHORT
        if (currentLow <= tp) {
          exitPrice = tp;
          exitReason = 'TAKE_PROFIT';
        } else if (currentHigh >= effectiveSl) {
          exitPrice = effectiveSl;
          exitReason = 'STOP_LOSS';
        } else if (currentHigh >= entryPrice * (1 + 0.175)) {
          exitPrice = entryPrice * (1 + 0.175);
          exitReason = 'LIQUIDATION';
        }
      }

      if (exitPrice !== null || i === len - 1) {
        if (exitPrice === null) {
          exitPrice = currentPrice;
          exitReason = 'END_OF_DATA';
        }

        // Apply slippage and fees
        const fee = sizeUsd * (commissionPct / 100) * 2;
        const slippage = sizeUsd * (slippagePct / 100);
        
        let priceDiffPct = side === 'BUY' ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
        let pnlUsd = (sizeUsd * priceDiffPct) - fee - slippage;
        let pnlPct = (pnlUsd / collateralUsd) * 100;

        capital += pnlUsd;
        if (capital > peakCapital) peakCapital = capital;
        const ddUsd = peakCapital - capital;
        const ddPct = (ddUsd / peakCapital) * 100;
        if (ddUsd > maxDrawdownUsd) maxDrawdownUsd = ddUsd;
        if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

        trades.push({
          tradeNum: trades.length + 1,
          symbol: params.symbol || 'BTC/USDT',
          side,
          entryTime: new Date(activePosition.entryTime).toISOString(),
          exitTime: new Date(currentTs).toISOString(),
          entryPrice: parseFloat(entryPrice.toFixed(4)),
          exitPrice: parseFloat(exitPrice.toFixed(4)),
          collateralUsd: parseFloat(collateralUsd.toFixed(2)),
          positionSizeUsd: parseFloat(sizeUsd.toFixed(2)),
          leverage,
          pnlUsd: parseFloat(pnlUsd.toFixed(2)),
          pnlPct: parseFloat(pnlPct.toFixed(2)),
          exitReason,
          isWin: pnlUsd > 0,
          durationBars: i - entryBar,
        });

        activePosition = null;
      }
      continue; // do not open another position on same bar
    }

    // ── Signal Generation ──────────────────────────────────────────────────
    const lowestLowPrev = Math.min(...lows.slice(i - obLookback, i));
    const highestHighPrev = Math.max(...highs.slice(i - obLookback, i));

    const bullishSweep = lows[i] < lowestLowPrev && closes[i] > lowestLowPrev && volSurge;
    const bearishSweep = highs[i] > highestHighPrev && closes[i] < highestHighPrev && volSurge;

    const rsiVal = rsiSeries[i];
    const mfiVal = mfiSeries[i];
    const ema20 = ema20Series[i];
    const ema50 = ema50Series[i];
    const prevClose = closes[i - 1];
    const prevEma20 = ema20Series[i - 1];

    const bullMomentum = rsiVal >= rsiLongMin && rsiVal <= rsiLongMax && mfiVal >= 50.0;
    const bearMomentum = rsiVal <= rsiShortMax && rsiVal >= rsiShortMin && mfiVal <= 50.0;

    let buySignal = false;
    let sellSignal = false;

    if (strategyType === 'casper_orb_retest') {
      // Retest breakout
      const isRetest = (lows[i] <= lowestLowPrev * 1.001) && (closes[i] > lowestLowPrev);
      buySignal = isRetest && bullMomentum && closes[i] > ema20;
      sellSignal = bearishSweep && bearMomentum && closes[i] < ema20;
    } else {
      // Default SMC LuxAlgo 5X
      const emaCrossUp = prevClose <= prevEma20 && currentPrice > ema20;
      const emaCrossDown = prevClose >= prevEma20 && currentPrice < ema20;

      buySignal = (bullishSweep || (currentPrice > ema20 && ema20 > ema50)) && bullMomentum && (emaCrossUp || bullishSweep);
      sellSignal = (bearishSweep || (currentPrice < ema20 && ema20 < ema50)) && bearMomentum && (emaCrossDown || bearishSweep);
    }

    if (buySignal || sellSignal) {
      const side = buySignal ? 'BUY' : 'SELL';
      const collateral = (capital * (positionSizePct / 100));
      if (collateral < 10) continue; // skip if capital depleted

      const sizeUsd = collateral * leverage;
      const entryPrice = currentPrice;
      const atr = atrSeries[i];

      const slPrice = side === 'BUY' ? entryPrice * (1.0 - slPct / 100.0) : entryPrice * (1.0 + slPct / 100.0);
      const tpPrice = side === 'BUY' ? entryPrice * (1.0 + tpPct / 100.0) : entryPrice * (1.0 - tpPct / 100.0);
      const trailingSl = side === 'BUY' ? entryPrice - (atr * atrMultiplier) : entryPrice + (atr * atrMultiplier);

      activePosition = {
        side,
        entryPrice,
        entryTime: currentTs,
        collateralUsd: collateral,
        sizeUsd,
        sl: slPrice,
        tp: tpPrice,
        trailingSl,
        entryBar: i,
      };
    }
  }

  // Performance calculations
  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.isWin);
  const losingTrades = trades.filter(t => !t.isWin);
  const winCount = winningTrades.length;
  const lossCount = losingTrades.length;
  const winRate = totalTrades > 0 ? winCount / totalTrades : 0;

  const grossProfit = winningTrades.reduce((acc, t) => acc + t.pnlUsd, 0);
  const grossLoss = Math.abs(losingTrades.reduce((acc, t) => acc + t.pnlUsd, 0));
  const profitFactor = grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(3)) : grossProfit > 0 ? 99.0 : 0.0;

  const netProfitUsd = parseFloat((capital - initialCapital).toFixed(2));
  const netProfitPct = parseFloat(((netProfitUsd / initialCapital) * 100).toFixed(2));

  const avgWinUsd = winCount > 0 ? grossProfit / winCount : 0;
  const avgLossUsd = lossCount > 0 ? grossLoss / lossCount : 0;
  const riskRewardRatio = avgLossUsd > 0 ? parseFloat((avgWinUsd / avgLossUsd).toFixed(2)) : parseFloat((tpPct / slPct).toFixed(2));

  // Kelly Criterion: K% = W - (1 - W) / R
  const kellyFraction = riskRewardRatio > 0 ? Math.max(0, parseFloat((winRate - ((1 - winRate) / riskRewardRatio)).toFixed(4))) : 0;

  // Returns array for Sharpe calculation
  const returns = trades.map(t => t.pnlPct / 100);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1 ? returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / (returns.length - 1) : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? parseFloat(((avgReturn / stdDev) * Math.sqrt(365)).toFixed(2)) : 0;

  // Sortino ratio (downside deviation only)
  const downsideReturns = returns.filter(r => r < 0);
  const downsideVar = downsideReturns.length > 0 ? downsideReturns.reduce((a, b) => a + Math.pow(b, 2), 0) / downsideReturns.length : 0;
  const downsideStdDev = Math.sqrt(downsideVar);
  const sortinoRatio = downsideStdDev > 0 ? parseFloat(((avgReturn / downsideStdDev) * Math.sqrt(365)).toFixed(2)) : 0;

  const gate68Met = winRate >= 0.68 && totalTrades >= 5;

  return {
    strategyType,
    symbol: params.symbol || 'BTC/USDT',
    timeframe: params.timeframe || '15m',
    leverage: `${leverage}X`,
    initialCapital,
    finalCapital: parseFloat(capital.toFixed(2)),
    netProfitUsd,
    netProfitPct,
    totalTrades,
    winCount,
    lossCount,
    winRate: parseFloat((winRate * 100).toFixed(1)),
    profitFactor,
    maxDrawdownUsd: parseFloat(maxDrawdownUsd.toFixed(2)),
    maxDrawdownPct: parseFloat(maxDrawdownPct.toFixed(2)),
    sharpeRatio,
    sortinoRatio,
    riskRewardRatio,
    kellyOptimalFractionPct: parseFloat((kellyFraction * 100).toFixed(1)),
    gate68Met,
    parameters: params,
    trades: trades.slice(-30), // include last 30 executed trades
  };
}

/**
 * High-level backtest entry point
 */
async function backtestStrategy({
  symbol = 'BTC/USDT',
  timeframe = '15m',
  strategyType = 'smc_luxalgo_5x',
  params = {},
  initialCapital = 1000,
  leverage = 5.0,
  limit = 250,
}) {
  const candles = await fetchHistoricalCandles(symbol, timeframe, limit);
  return runBacktestSimulation({
    candles,
    strategyType,
    params: { ...params, symbol, timeframe },
    initialCapital,
    leverage,
  });
}

module.exports = {
  fetchHistoricalCandles,
  generateSyntheticCandles,
  runBacktestSimulation,
  backtestStrategy,
};
