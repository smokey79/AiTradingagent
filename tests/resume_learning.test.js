'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ROOT = path.resolve(__dirname, '..');
const logger = { info() {}, warn() {}, error() {}, debug() {} };

function load(file, dependencies, globals = {}, dirname = path.dirname(path.join(ROOT, file))) {
  const module = { exports: {} };
  const context = {
    module, exports: module.exports, __dirname: dirname, process: { env: {} }, console,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (['fs', 'path'].includes(name)) return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
    ...globals,
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  return module.exports;
}

test('fast ticks monitor exits; configured entry interval and kill switch are honoured', async () => {
  let now = 0, halted = false, entries = 0, monitors = 0;
  let pending = null;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const engine = load('src/orchestrator/autoTrader.js', {
    axios: {}, '../utils/logger': logger,
    './index': { runTradingCycle: async () => { entries++; return []; } },
    './positionMonitor': { monitorOpenPositions: async () => { monitors++; } },
    '../arbitrage/arbScanner': {}, '../flashloan/flashloanExecutor': {},
    '../data/dexScreenerFeed': { scanTrendingMemeCoins: async () => [] },
    '../risk/tradeLedger': {},
    '../risk/riskGate': { getPortfolioState: () => ({ openCount: 1 }) },
    '../utils/killSwitch': { isKillSwitchEngaged: () => halted },
    '../utils/profitAllocator': { getVaultSummary: () => ({}) },
    '../health/systemHealthCheck': { startHealthChecks() {}, updateHeartbeat() {} },
    '../arbitrage/continuousArbEngine': { startContinuousArb() {}, stopContinuousArb() {}, getStatus: () => ({ totalArbTrades: 0 }) },
  }, { Date: Clock, setTimeout(fn, delay) { pending = { fn, at: now + delay }; return 1; }, clearTimeout() { pending = null; } });
  const tick = async () => { const next = pending; pending = null; now = next.at; await next.fn(); };
  engine.startAutoTrading(600, true);
  await tick();
  assert.equal(entries, 1);
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(entries, 1);
  assert.equal(monitors, 5);
  await tick();
  assert.equal(entries, 2);
  halted = true;
  await tick();
  assert.equal(entries, 2);
  assert.equal(monitors, 6);
  engine.stopAutoTrading();
  assert.equal(pending, null);
  engine.startAutoTrading(1200, false);
  assert.equal(pending.at - now, 1200000);
  engine.stopAutoTrading();
});

test('position monitor routes venues, rejects bad prices and tolerates feed failures', async () => {
  const fetched = [];
  let prices;
  const monitor = load('src/orchestrator/positionMonitor.js', {
    '../risk/riskGate': {
      getPortfolioState: () => ({ openPositions: ['ETH/USDT', 'BTC/USDT', 'SOL/USDT', 'EUR/USD', 'AAPL'].map(pair => ({ pair })) }),
      resolveAllOpenPositions: p => { prices = p; return ['resolved']; },
    },
    '../utils/instrumentUniverse': { isOandaPair: p => p === 'EUR/USD', isAlpacaPair: p => p === 'AAPL' },
    '../data/marketData': { fetchMarketData: async pair => {
      fetched.push(pair);
      if (pair === 'SOL/USDT') throw new Error('offline');
      return { price: { price: 100 }, quality: { ok: pair !== 'BTC/USDT' } };
    } },
    '../data/oandaMarketData': { fetchOandaMarketData: async () => ({ price: { price: 1.2 } }) },
    '../data/alpacaMarketData': { fetchAlpacaMarketData: async () => ({ price: { price: NaN } }) },
  });
  assert.equal((await monitor.monitorOpenPositions())[0], 'resolved');
  assert.deepEqual({ ...prices }, { 'ETH/USDT': 100, 'EUR/USD': 1.2 });
  assert.equal(fetched.length, 3);
});

test('learning uses vetted SQLite rows, includes late outcomes and survives restarts', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-learning-'));
  const oldPath = process.env.LEDGER_DB_PATH;
  process.env.LEDGER_DB_PATH = path.join(tmp, 'ledger.db');
  const db = require('../src/utils/ledgerDb');
  const trades = require('../src/learning/learningTrades');
  const wins = [], losses = [];
  const report = load('src/learning/improvementLoop.js', {
    dotenv: { config() {} }, './learningTrades': trades, '../risk/capitalPolicy': require('../src/risk/capitalPolicy'),
  }, {}, path.join(tmp, 'src/learning'));
  const boot = () => load('src/agents/learningAgent.js', {
    '../utils/logger': logger, '../learning/learningTrades': trades,
    '../learning/improvementLoop': report,
    '../learning/lossLearner': { recordLossPostMortem: t => losses.push(t) },
    '../learning/tradeLearner': { recordWinPostMortem: t => wins.push(t) },
    'node-cron': { schedule() {} },
  }, { Date, Set }, path.join(tmp, 'src/agents'));
  const row = o => ({ id: 'good', timestamp: '2026-09-01T00:00:00Z', pair: 'ETH/USDT', side: 'BUY',
    entryPrice: 100, exitPrice: 110, price: 110, pnlUsd: 1, costUsd: 0.1, outcome: 'WIN', paper: true, ...o });
  try {
    db.upsertTrade(row({}));
    db.upsertTrade(row({ id: 'fake', isSimulated: true }));
    db.upsertTrade(row({ id: 'excluded', excludeFromLearning: true }));
    db.upsertTrade(row({ id: 'no-fees', feesIncluded: false }));
    db.upsertTrade(row({ id: 'pending', side: 'SHORT', outcome: 'PENDING' }));
    db.upsertTrade(row({ id: 'missing-price', entryPrice: null }));
    const agent = boot();
    await agent.runBatchReview();
    assert.equal(wins.length, 1);
    assert.equal(wins[0].entryPrice, 100);
    assert.equal(wins[0].exitPrice, 110);
    await agent.runBatchReview();
    assert.equal(wins.length, 1);
    db.upsertTrade(row({ id: 'pending', side: 'SHORT', outcome: 'LOSS', pnlUsd: -2 }));
    await agent.runBatchReview();
    assert.equal(losses.length, 1);
    assert.equal(losses[0].side, 'SELL');
    await boot().runBatchReview();
    assert.equal(wins.length, 1);
    assert.equal(losses.length, 1);
    const summary = JSON.parse(fs.readFileSync(path.join(tmp, 'data/learning/latest.json'), 'utf8'));
    assert.equal(summary.overall.trades, 3);
    assert.equal(summary.mode, 'PAPER');
    assert.equal(summary.evidence.sampleSufficient, false);
    assert.equal(summary.autoApplied.length, 0);
  } finally {
    db.close();
    if (oldPath === undefined) delete process.env.LEDGER_DB_PATH; else process.env.LEDGER_DB_PATH = oldPath;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
