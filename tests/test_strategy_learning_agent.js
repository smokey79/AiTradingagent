/**
 * Unit Test Suite for Strategy Learning Agent, Pine Script v5 Generator, and Backtesting Engine
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
  getSignal,
  optimizeStrategy,
  backtestStrategy,
  generatePineScript,
  exportPineScriptToFile,
  loadLearnedStrategies,
  STRATEGY_PRESETS,
} = require('../src/learning/strategyLearningAgent');

const {
  runBacktestSimulation,
  generateSyntheticCandles,
} = require('../src/learning/backtestEngine');

async function runTests() {
  console.log('🧪 Starting Strategy Learning Agent Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function it(desc, fn) {
    try {
      fn();
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${desc} -> ${err.message}`);
      failed++;
    }
  }

  async function itAsync(desc, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${desc} -> ${err.message}`);
      failed++;
    }
  }

  // ─── Test 1: Pine Script Generation ───────────────────────────────────────
  it('Should generate valid Pine Script v5 for LuxAlgo SMC strategy', () => {
    const code = generatePineScript('smc_luxalgo_5x', 'BTC/USDT');
    assert(code.includes('//@version=5'), 'Missing //@version=5');
    assert(code.includes('strategy('), 'Missing strategy declaration');
    assert(code.includes('SMC_5X_LONG'), 'Missing long entry ID');
    assert(code.includes('alert_message'), 'Missing webhook alert payload');
    assert(code.includes('atr_sl_mult'), 'Missing ATR trailing multiplier');
  });

  it('Should generate valid Pine Script v5 for Casper ORB Retest strategy', () => {
    const code = generatePineScript('casper_orb_retest', 'ETH/USDT');
    assert(code.includes('//@version=5'), 'Missing //@version=5');
    assert(code.includes('ORB_LONG'), 'Missing ORB entry');
    assert(code.includes('orb_hour'), 'Missing ORB hour input');
  });

  it('Should export Pine Script file to strategy directory', () => {
    const res = exportPineScriptToFile('smc_luxalgo_5x', 'BTC/USDT');
    assert.strictEqual(res.success, true);
    assert(fs.existsSync(res.filePath), 'Exported file does not exist');
    assert(res.code.length > 500, 'Code length too short');
  });

  // ─── Test 2: Backtesting Engine Simulation ────────────────────────────────
  it('Should execute backtest simulation with accurate metrics on synthetic candles', () => {
    const candles = generateSyntheticCandles(77000, 200, '15m');
    assert.strictEqual(candles.length, 200);

    const result = runBacktestSimulation({
      candles,
      strategyType: 'smc_luxalgo_5x',
      initialCapital: 1000,
      leverage: 5.0,
    });

    assert(typeof result.netProfitUsd === 'number', 'Net profit should be a number');
    assert(typeof result.winRate === 'number', 'Win rate should be a number');
    assert(typeof result.profitFactor === 'number', 'Profit factor should be a number');
    assert(typeof result.sharpeRatio === 'number', 'Sharpe ratio should be a number');
    assert(typeof result.maxDrawdownPct === 'number', 'Max drawdown should be a number');
    assert(Array.isArray(result.trades), 'Trades should be an array');
  });

  // ─── Test 3: Strategy Learning & Optimization ─────────────────────────────
  await itAsync('Should optimize strategy hyperparameters and save to brain memory', async () => {
    const learned = await optimizeStrategy({
      symbol: 'BTC/USDT',
      timeframe: '15m',
      strategyType: 'smc_luxalgo_5x',
      iterations: 4,
      leverage: 5.0,
    });

    assert(learned.id.startsWith('STRAT_'), 'Strategy ID should start with STRAT_');
    assert(learned.backtest, 'Strategy should include backtest results');
    assert(learned.pinescript.includes('//@version=5'), 'Should include valid PineScript');

    const allLearned = loadLearnedStrategies();
    assert(allLearned.length > 0, 'Learned strategies list should not be empty');
    assert(allLearned.some(s => s.id === learned.id), 'Newly learned strategy should be saved');
  });

  // ─── Test 4: Agent Signal Generation (Consensus Hook) ─────────────────────
  await itAsync('Should generate consensus-ready TA/SMC signal', async () => {
    const signal = await getSignal('BTC/USDT', { price: { price: 77500 } });
    assert.strictEqual(signal.agent, 'strategy_learner');
    assert(['BUY', 'SELL', 'HOLD'].includes(signal.signal), 'Signal must be BUY, SELL, or HOLD');
    assert(signal.confidence >= 0.50 && signal.confidence <= 1.0, 'Confidence must be between 0.5 and 1.0');
    assert(signal.indicators, 'Signal must include technical indicators');
    assert(signal.futures_5x, 'Signal must include 5X futures presets');
    assert.strictEqual(signal.futures_5x.leverage, 5.0);
    assert.strictEqual(signal.futures_5x.roi_target_pct, 20.0);
  });

  console.log(`\n==================================================`);
  console.log(`Test Results: ${passed} Passed | ${failed} Failed`);
  console.log(`==================================================\n`);

  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
