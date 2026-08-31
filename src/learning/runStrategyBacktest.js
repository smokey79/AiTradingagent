/**
 * Strategy Learner & Backtesting CLI Runner
 * Usage:
 *   node src/learning/runStrategyBacktest.js
 *   node src/learning/runStrategyBacktest.js --symbol ETH/USDT --timeframe 15m --optimize
 *   node src/learning/runStrategyBacktest.js --symbol SOL/USDT --strategy casper_orb_retest --export-pine
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const logger = require('../utils/logger');
const {
  backtestStrategy,
  optimizeStrategy,
  generatePineScript,
  exportPineScriptToFile,
  loadLearnedStrategies,
} = require('./strategyLearningAgent');

async function main() {
  const args = process.argv.slice(2);
  let symbol = 'BTC/USDT';
  let timeframe = '15m';
  let strategyType = 'smc_luxalgo_5x';
  let doOptimize = false;
  let doExportPine = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--symbol' && args[i + 1]) symbol = args[++i].toUpperCase();
    if (args[i] === '--timeframe' && args[i + 1]) timeframe = args[++i];
    if (args[i] === '--strategy' && args[i + 1]) strategyType = args[++i];
    if (args[i] === '--optimize') doOptimize = true;
    if (args[i] === '--export-pine') doExportPine = true;
  }

  console.log('\n================================================================');
  console.log('🤖 AiTradingAgent — Strategy Learning & Backtesting Engine');
  console.log('================================================================');
  console.log(`Symbol    : ${symbol}`);
  console.log(`Timeframe : ${timeframe}`);
  console.log(`Strategy  : ${strategyType}`);
  console.log(`Mode      : ${doOptimize ? 'Self-Learning Hyperparameter Optimization' : 'Standard Simulation Backtest'}`);
  console.log('----------------------------------------------------------------\n');

  if (doOptimize) {
    console.log(`⏳ Running evolutionary parameter sweep on ${symbol} (${timeframe})...`);
    const learned = await optimizeStrategy({
      symbol,
      timeframe,
      strategyType,
      iterations: 8,
      leverage: 5.0,
    });

    console.log('\n✅ OPTIMIZATION COMPLETE — BEST STRATEGY FOUND:');
    console.log(`ID               : ${learned.id}`);
    console.log(`Name             : ${learned.name}`);
    console.log(`Win Rate         : ${learned.backtest.winRate}% (Target Gate: 68.0%) -> ${learned.gate68Met ? '✅ PASSED' : '⚠️ PENDING'}`);
    console.log(`Profit Factor    : ${learned.backtest.profitFactor}`);
    console.log(`Net Profit       : $${learned.backtest.netProfitUsd} (${learned.backtest.netProfitPct}%)`);
    console.log(`Total Trades     : ${learned.backtest.totalTrades} (${learned.backtest.winCount} Wins / ${learned.backtest.lossCount} Losses)`);
    console.log(`Sharpe Ratio     : ${learned.backtest.sharpeRatio}`);
    console.log(`Sortino Ratio    : ${learned.backtest.sortinoRatio}`);
    console.log(`Max Drawdown     : ${learned.backtest.maxDrawdownPct}% ($${learned.backtest.maxDrawdownUsd})`);
    console.log(`Kelly Sizing     : ${learned.backtest.kellyOptimalFractionPct}% optimal capital allocation`);
    console.log(`Optimal Params   :`, JSON.stringify(learned.parameters, null, 2));

    if (doExportPine) {
      const exportRes = exportPineScriptToFile(strategyType, symbol, learned.parameters);
      if (exportRes.success) {
        console.log(`\n🌲 Pine Script v5 File Generated:\n-> ${exportRes.filePath}`);
      }
    }
  } else {
    console.log(`⏳ Running institutional backtest simulation on ${symbol} (${timeframe})...`);
    const bt = await backtestStrategy({
      symbol,
      timeframe,
      strategyType,
      initialCapital: 1000,
      leverage: 5.0,
    });

    console.log('\n📊 BACKTEST PERFORMANCE REPORT:');
    console.log(`Initial Capital  : $${bt.initialCapital}`);
    console.log(`Final Capital    : $${bt.finalCapital}`);
    console.log(`Net Profit       : +$${bt.netProfitUsd} (+${bt.netProfitPct}%)`);
    console.log(`Total Trades     : ${bt.totalTrades} (${bt.winCount} Wins / ${bt.lossCount} Losses)`);
    console.log(`Win Rate         : ${bt.winRate}% (Gate 68%: ${bt.gate68Met ? '✅ PASSED' : '⚠️ PENDING'})`);
    console.log(`Profit Factor    : ${bt.profitFactor}`);
    console.log(`Max Drawdown     : ${bt.maxDrawdownPct}% ($${bt.maxDrawdownUsd})`);
    console.log(`Sharpe Ratio     : ${bt.sharpeRatio}`);
    console.log(`Sortino Ratio    : ${bt.sortinoRatio}`);
    console.log(`Risk-Reward (RR) : 1:${bt.riskRewardRatio}`);
    console.log(`Kelly Fraction   : ${bt.kellyOptimalFractionPct}%`);

    if (doExportPine) {
      const exportRes = exportPineScriptToFile(strategyType, symbol);
      if (exportRes.success) {
        console.log(`\n🌲 Pine Script v5 File Generated:\n-> ${exportRes.filePath}`);
      }
    }
  }

  const allLearned = loadLearnedStrategies();
  console.log(`\n📚 Total Learned Strategies in Brain: ${allLearned.length}`);
  console.log('================================================================\n');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}

module.exports = { main };
