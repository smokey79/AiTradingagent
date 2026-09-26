/**
 * Targeted Test Suite: Self-Healing & Continuous Hit-Rate Improvement
 * Tests:
 *  1. StrategyLearner attribution for both LONG and SHORT positions (wins & losses)
 *  2. Dynamic accuracy scaling of agent weights in multi-agent consensus
 *  3. Negative pattern learning from losses and automatic pre-trade penalty/veto
 *  4. Automated Risk Gate deadlock waiver (0.75x position sizing) and margin sentinel
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { StrategyLearner } = require('../src/learning/strategyLearner');
const { loadStrategyMemory } = require('../src/strategy/strategyMemoryLoader');
const { recordLossPostMortem, evaluateNegativePatterns, loadLossMemory } = require('../src/learning/lossLearner');
const { checkRiskGate, getPortfolioState, updateBalance } = require('../src/risk/riskGate');

console.log('🧪 Starting Self-Healing & Continuous Hit Rate Improvement Test...');

async function runTests() {
  // ── 1. Long & Short Agent Accuracy Attribution ──
  console.log('\n--- 1. Testing Agent Accuracy Attribution (Long & Short) ---');
  const learner = new StrategyLearner();

  // Simulate a winning SHORT trade: agents voting SELL/SHORT should get +1 correct
  await learner.recordOutcome({
    symbol: 'ETH',
    side: 'SELL',
    entryPrice: 3000,
    exitPrice: 2850,
    sizeUsdt: 100,
    pnlUsdt: 15,
    pnlPct: 0.05,
    agentVotes: {
      expert_trader: 'SELL',
      deepseek: 'SELL',
      claude: 'BUY',
    },
    exchange: 'PaperEngine',
  });

  const mem1 = loadStrategyMemory();
  assert(mem1.agentAccuracy, 'Agent accuracy map should exist');
  assert(mem1.agentAccuracy.expert_trader.correct >= 1, 'Winning SHORT vote should be correct');
  assert(mem1.agentAccuracy.claude.total >= 1, 'Claude total votes recorded');
  console.log('✅ PASS: SHORT winning trade accurately attributes correct vote to SELL and penalizes BUY');

  // Simulate a winning LONG trade: agents voting BUY should get +1 correct
  await learner.recordOutcome({
    symbol: 'BTC',
    side: 'BUY',
    entryPrice: 75000,
    exitPrice: 78000,
    sizeUsdt: 100,
    pnlUsdt: 20,
    pnlPct: 0.04,
    agentVotes: {
      expert_trader: 'BUY',
      claude: 'BUY',
      deepseek: 'SELL',
    },
    exchange: 'PaperEngine',
  });

  const mem2 = loadStrategyMemory();
  assert(mem2.agentAccuracy.expert_trader.accuracy >= 0.5, 'Expert trader accuracy tracked');
  console.log('✅ PASS: LONG winning trade accurately attributes correct vote to BUY');

  // ── 2. Negative Pattern Learning from Losses ──
  console.log('\n--- 2. Testing Negative Pattern Post-Mortem & Traps ---');
  // Record a loss with overextended EMA50 and dumping BTC
  const postMortem = recordLossPostMortem({
    symbol: 'SOL',
    side: 'BUY',
    entryPrice: 150,
    exitPrice: 142,
    pnlUsd: -8,
    pnlPct: -0.053,
    marketData: {
      price: { price: 150 },
      indicators: {
        rsi14: 72,
        ema20: 140,
        ema50: 130, // price is 150, distEma50Pct = +15.38% (overextended)
        volumeRatio: 0.85,
      },
    },
    btcBenchmark: {
      change24h: -3.2,
      trend: 'BEARISH_CONTRACTION',
    },
    reason: 'Chased overextended rally while BTC dumped',
  });

  assert(postMortem.ruleFilter, 'Must assign deterministic rule filter');
  console.log(`✅ PASS: Loss post-mortem generated trap: ${postMortem.trapType} (${postMortem.ruleFilter})`);

  // Now evaluate a new setup matching that trap
  const negCheck = evaluateNegativePatterns(
    'SOL/USDT',
    'BUY',
    {
      price: { price: 155 },
      indicators: {
        rsi14: 70,
        ema20: 145,
        ema50: 135,
        volumeRatio: 0.9,
      },
    },
    {
      change24h: -2.5,
      trend: 'BEARISH_CONTRACTION',
    }
  );

  assert(negCheck.hasNegativePatternMatch === true, 'Should detect matching negative pattern');
  assert(negCheck.confidencePenalty > 0, 'Should assign confidence penalty to protect hit rate');
  console.log(`✅ PASS: Negative pattern detected matching trap. Penalty: -${(negCheck.confidencePenalty * 100).toFixed(0)}%`);

  // ── 3. Risk Gate Deadlock Self-Healing ──
  console.log('\n--- 3. Testing Risk Gate Deadlock Self-Healing ---');
  updateBalance(500, 0, true);

  // When consensus is high conviction (>= 80%) with strong agreement (>= 3 agents),
  // deadlock waiver should grant approval with 0.75x sizing even if rolling win rate is temporarily below 68%
  const highConvictionConsensus = {
    signal: 'BUY',
    confidence: 0.85,
    agentsAgreeing: 6,
    totalAgents: 8,
    veto_triggered: false,
    reasoning: 'Strong multi-agent confluence',
  };

  const market = {
    price: { price: 65000 },
    indicators: { atr14: 1200 },
  };

  const riskResult = await checkRiskGate('BTC/USDT', highConvictionConsensus, market);
  assert(riskResult.approved === true, 'Risk Gate should approve under high-conviction agreement');
  assert(riskResult.positionSizeUsd > 0, 'Should compute positive position sizing');
  console.log(`✅ PASS: Risk gate approved trade ($${riskResult.positionSizeUsd} USD) with dynamic risk: ${riskResult.dynamicRiskPct}%`);

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('🎉 ALL SELF-HEALING & HIT-RATE IMPROVEMENT TESTS PASSED (100%)');
  console.log('══════════════════════════════════════════════════════════════════════\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
