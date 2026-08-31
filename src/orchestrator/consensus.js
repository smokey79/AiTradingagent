/**
 * Multi-Agent Consensus Engine
 * Coordinates 8 specialized AI agents (Claude, GPT-4o, DeepSeek R1/V3, Gemini,
 * Grok, OpenRouter Free Tier, Perplexity, Hermes, and YouTube Sentiment),
 * applies dynamic weighting, resolves conflicts, detects hard vetoes, and produces master trading decisions.
 */
const logger = require('../utils/logger');
const claudeAgent = require('../agents/claudeAgent');
const gpt4oAgent = require('../agents/gpt4oAgent');
const deepseekAgent = require('../agents/deepseekAgent');
const geminiAgent = require('../agents/geminiAgent');
const grokAgent = require('../agents/grokAgent');
const openrouterFreeAgent = require('../agents/openrouterFreeAgent');
const perplexityAgent = require('../agents/perplexityAgent');
const hermesAgent = require('../agents/hermesAgent');
const sentimentAgent = require('../agents/youtubeSentimentAgent');
const defiAgent = require('../agents/defiAgent');
const intelligentSignalsAgent = require('../agents/intelligentSignalsAgent');
const smcAgent = require('../agents/smcAgent');
const strategyLearningAgent = require('../agents/strategyLearningAgent');
const healthMonitor = require('../health/agentHealthMonitor');
const { isExcluded } = require('../health/selfHealer');

// Credibility weights
const AGENT_WEIGHTS = {
  deepseek: 0.20,        // Quantitative SMC & reasoning
  claude: 0.20,          // Technical analysis & chart patterns
  smc_agent: 0.20,       // Casper SMC & LuxAlgo Order Blocks
  strategy_learner: 0.15,// Backtested PineScript & Adaptive Technicals
  gpt4o: 0.15,           // Macro & institutional sentiment
  gemini: 0.15,          // Cross-validation & risk gate
  openrouter_free: 0.10, // Zero-cost multi-model free router
  grok: 0.10,            // Real-time news & orderbook imbalance
  defi: 0.15,            // Deterministic high-probability DeFi metrics
  intelligent_signals: 0.15, // Machine learning & feature engineering feeds
  perplexity: 0.05,      // Fundamentals & tokenomics
  hermes: 0.05,          // Local consensus tie-breaker
  sentiment: 0.05,       // Media alpha & YouTube intelligence
};

const SIGNAL_VALUES = {
  BUY: 1.0,
  bullish: 1.0,
  SELL: -1.0,
  bearish: -1.0,
  HOLD: 0.0,
  neutral: 0.0,
};

function normalizeSignal(sig) {
  if (!sig) return 'HOLD';
  const upper = sig.toUpperCase();
  if (upper === 'BUY' || upper === 'BULLISH') return 'BUY';
  if (upper === 'SELL' || upper === 'BEARISH') return 'SELL';
  return 'HOLD';
}

function withTimeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function runConsensus(pair, marketData) {
  const symbol = pair.split('/')[0];
  logger.info(`[${pair}] Initiating multi-agent parallel consensus pipeline (with DeepSeek R1 & OpenRouter Free Tier)...`);

  // Step 1: Parallel calls to core specialist agents (with health timing)
  const agentCallStart = Date.now();
  const agentTimers = {};
  function timedAgent(name, promise) {
    agentTimers[name] = Date.now();
    return promise;
  }

  const [
    deepseekRes,
    claudeRes,
    gpt4oRes,
    grokRes,
    openrouterFreeRes,
    perplexityRes,
    hermesRes,
    sentimentRes,
    defiRes,
    intelligentSignalsRes,
    smcRes,
    strategyLearnerRes,
  ] = await Promise.allSettled([
    // Tiered timeouts: local agents are faster, penalise slow cloud agents less
    timedAgent('deepseek',            withTimeout(isExcluded('deepseek')            ? Promise.reject(new Error('excluded')) : deepseekAgent.getSignal(symbol, marketData),            10000, 'DeepSeek')),
    timedAgent('claude',              withTimeout(isExcluded('claude')              ? Promise.reject(new Error('excluded')) : claudeAgent.getSignal(symbol, marketData),              10000, 'Claude')),
    timedAgent('gpt4o',               withTimeout(isExcluded('gpt4o')               ? Promise.reject(new Error('excluded')) : gpt4oAgent.getSignal(symbol, marketData),               10000, 'GPT-4o')),
    timedAgent('grok',                withTimeout(isExcluded('grok')                ? Promise.reject(new Error('excluded')) : grokAgent.getSignal(symbol, marketData),                10000, 'Grok')),
    timedAgent('openrouter_free',     withTimeout(isExcluded('openrouter_free')     ? Promise.reject(new Error('excluded')) : openrouterFreeAgent.getSignal(symbol, marketData),      10000, 'OpenRouterFree')),
    timedAgent('perplexity',          withTimeout(isExcluded('perplexity')          ? Promise.reject(new Error('excluded')) : perplexityAgent.getSignal(symbol, marketData),           10000, 'Perplexity')),
    timedAgent('hermes',              withTimeout(isExcluded('hermes')              ? Promise.reject(new Error('excluded')) : hermesAgent.getSignal(symbol, marketData),               5000,  'Hermes')),   // local — fast
    timedAgent('sentiment',           withTimeout(isExcluded('sentiment')           ? Promise.reject(new Error('excluded')) : sentimentAgent.getSentimentSignal(symbol),               5000,  'Sentiment')), // cached — fast
    timedAgent('defi',                withTimeout(isExcluded('defi')                ? Promise.reject(new Error('excluded')) : defiAgent.getSignal(symbol, marketData),                 5000,  'DeFi')),
    timedAgent('intelligent_signals', withTimeout(isExcluded('intelligent_signals') ? Promise.reject(new Error('excluded')) : intelligentSignalsAgent.getSignal(symbol, marketData),     5000,  'IntelligentSignals')),
    timedAgent('smc_agent',           withTimeout(isExcluded('smc_agent')           ? Promise.reject(new Error('excluded')) : smcAgent.getSignal(symbol, marketData),                   5000,  'SMCAgent')),
    timedAgent('strategy_learner',    withTimeout(isExcluded('strategy_learner')    ? Promise.reject(new Error('excluded')) : strategyLearningAgent.getSignal(symbol, marketData),      5000,  'StrategyLearner')),
  ]);

  // Record health outcomes for every agent
  const agentResults = {
    deepseek: deepseekRes, claude: claudeRes, gpt4o: gpt4oRes,
    grok: grokRes, openrouter_free: openrouterFreeRes,
    perplexity: perplexityRes, hermes: hermesRes, sentiment: sentimentRes,
    defi: defiRes, intelligent_signals: intelligentSignalsRes, smc_agent: smcRes,
    strategy_learner: strategyLearnerRes,
  };
  for (const [name, res] of Object.entries(agentResults)) {
    const latency = agentTimers[name] ? Date.now() - agentTimers[name] : 0;
    healthMonitor.record(
      name,
      res.status === 'fulfilled',
      latency,
      res.status === 'rejected' ? (res.reason?.message || 'failed') : null
    );
  }

  const agentOutputs = [];

  function processResult(name, res) {
    if (res.status === 'fulfilled' && res.value) {
      const normSig = normalizeSignal(res.value.signal);
      const conf = Math.max(0, Math.min(1, parseFloat(res.value.confidence) || 0.70));
      const health = healthMonitor.getAgent(name);
      agentOutputs.push({
        agent: name,
        signal: normSig,
        confidence: conf,
        reason: res.value.reason || '',
        weight: AGENT_WEIGHTS[name] || 0.10,
        veto_flag: !!res.value.veto_flag,
        veto_reason: res.value.veto_reason || null,
        model_used: res.value.model_used || null,
        provider: res.value.provider || null,
        details: res.value,
        health: { status: health.status, latencyMs: health.latencyMs, errorRate: health.errorRate },
      });
      logger.info(`  [${name.padEnd(16)}] -> ${normSig.padEnd(4)} @ ${(conf * 100).toFixed(0)}% | [${health.status}] ${res.value.reason?.slice(0, 55)}`);
    } else {
      const isExc = res.reason?.message === 'excluded';
      logger.warn(`  [${name.padEnd(16)}] -> ${isExc ? 'EXCLUDED' : 'FAILED'}: ${res.reason?.message || 'Unknown error'}`);
    }
  }

  processResult('deepseek', deepseekRes);
  processResult('claude', claudeRes);
  processResult('gpt4o', gpt4oRes);
  processResult('grok', grokRes);
  processResult('openrouter_free', openrouterFreeRes);
  processResult('perplexity', perplexityRes);
  processResult('hermes', hermesRes);
  processResult('sentiment', sentimentRes);
  processResult('defi', defiRes);
  processResult('intelligent_signals', intelligentSignalsRes);
  processResult('smc_agent', smcRes);
  processResult('strategy_learner', strategyLearnerRes);

  // ── Fast-track: skip Gemini if consensus is already crystal clear ──────────
  // If 6+ agents agree with avg confidence ≥ 0.80 we don't need cross-validation.
  // This saves up to 10s per cycle when the market signal is unambiguous.
  const preFastTrack = agentOutputs.filter(a => a.signal !== 'HOLD');
  const dominantSignal = preFastTrack.length >= 6
    ? (preFastTrack.filter(a => a.signal === 'BUY').length > preFastTrack.filter(a => a.signal === 'SELL').length ? 'BUY' : 'SELL')
    : null;
  const dominantAgree  = dominantSignal ? preFastTrack.filter(a => a.signal === dominantSignal) : [];
  const avgFastConf    = dominantAgree.length ? dominantAgree.reduce((s, a) => s + a.confidence, 0) / dominantAgree.length : 0;
  const fastTrack      = dominantAgree.length >= 6 && avgFastConf >= 0.80;

  let geminiOutput = null;
  if (fastTrack) {
    logger.info(`  [${'gemini'.padEnd(16)}] -> ⚡ FAST-TRACK (${dominantAgree.length}/8 agents @ ${(avgFastConf*100).toFixed(0)}% avg — Gemini skipped)`);
  } else {
    // Step 2: Gemini Cross-Validator receives all peer signals
    try {
      const geminiRaw = await withTimeout(
        geminiAgent.getSignal(symbol, marketData, agentOutputs),
        8000,  // tightened from 12s — Gemini 1.5-flash is fast
        'Gemini'
      );
      const geminiNorm = normalizeSignal(geminiRaw.signal);
      const geminiConf = Math.max(0, Math.min(1, parseFloat(geminiRaw.confidence) || 0.80));
      const health = healthMonitor.getAgent('gemini');
      geminiOutput = {
        agent: 'gemini',
        signal: geminiNorm,
        confidence: geminiConf,
        reason: geminiRaw.reason || 'Cross-validation checks completed',
        weight: AGENT_WEIGHTS.gemini,
        validation_result: geminiRaw.validation_result || 'PASS',
        agent_conflicts_detected: geminiRaw.agent_conflicts_detected || [],
        details: geminiRaw,
        health: { status: health.status, latencyMs: health.latencyMs },
      };
      agentOutputs.push(geminiOutput);
      logger.info(`  [${'gemini'.padEnd(16)}] -> ${geminiNorm.padEnd(4)} @ ${(geminiConf * 100).toFixed(0)}% [Cross-Validator: ${geminiOutput.validation_result}]`);
    } catch (err) {
      logger.warn(`  [${'gemini'.padEnd(16)}] -> Cross-validation failed: ${err.message}`);
    }
  }

  // Step 3: Check Hard Vetoes
  const vetoFlags = agentOutputs.filter(a => a.veto_flag);
  if (vetoFlags.length > 0) {
    const vetoReasons = vetoFlags.map(v => `${v.agent}: ${v.veto_reason}`).join('; ');
    logger.warn(`[${pair}] 🛑 HARD VETO TRIGGERED: ${vetoReasons}`);
    return {
      symbol,
      pair,
      timestamp: new Date().toISOString(),
      signal: 'HOLD',
      confidence: 0.0,
      consensus_reached: false,
      approved_for_execution: false,
      veto_triggered: true,
      veto_reason: vetoReasons,
      agentsAgreeing: 0,
      totalAgents: agentOutputs.length,
      breakdown: agentOutputs,
      reasoning: `Trade vetoed for capital preservation: ${vetoReasons}`,
    };
  }

  // Step 4: Calculate weighted consensus score
  let weightedScore = 0;
  let totalWeight = 0;

  for (const s of agentOutputs) {
    const val = SIGNAL_VALUES[s.signal] || 0;
    const effectiveWeight = s.weight * s.confidence;
    weightedScore += val * effectiveWeight;
    totalWeight += effectiveWeight;
  }

  const avgScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
  let finalSignal = 'HOLD';
  if (avgScore >= 0.25) finalSignal = 'BUY';
  else if (avgScore <= -0.25) finalSignal = 'SELL';

  const agreeingAgents = agentOutputs.filter(a => a.signal === finalSignal && a.signal !== 'HOLD');
  const agentsAgreeing = agreeingAgents.length;
  const totalAgents = agentOutputs.length;

  // Scale consensus confidence by agent agreement ratio and score magnitude
  const rawConfidence = Math.abs(avgScore);
  const agreementRatio = totalAgents > 0 ? agentsAgreeing / totalAgents : 0;
  const consensusConfidence = Math.min(
    0.98,
    parseFloat((rawConfidence * 0.7 + agreementRatio * 0.3).toFixed(3))
  );

  // Lowered for demo to ensure it executes trades aggressively
  const consensusReached = agentsAgreeing >= 2 && consensusConfidence >= 0.35;
  const approvedForExecution = consensusReached && finalSignal !== 'HOLD';

  const synthesis = {
    symbol,
    pair,
    timestamp: new Date().toISOString(),
    signal: finalSignal,
    confidence: consensusConfidence,
    weightedScore: parseFloat(avgScore.toFixed(3)),
    consensus_reached: consensusReached,
    approved_for_execution: approvedForExecution,
    veto_triggered: false,
    veto_reason: null,
    agentsAgreeing,
    totalAgents,
    breakdown: agentOutputs,
    reasoning: generateConsensusReasoning(finalSignal, consensusConfidence, agentsAgreeing, totalAgents, agentOutputs),
  };

  logger.info(
    `[${pair}] Master Consensus: ${finalSignal} @ ${(consensusConfidence * 100).toFixed(1)}% (${agentsAgreeing}/${totalAgents} agents agreeing) -> ${approvedForExecution ? '✅ APPROVED' : '⚠️ HOLD/SKIPPED'}`
  );

  return synthesis;
}

function generateConsensusReasoning(signal, confidence, agreeing, total, agents) {
  if (signal === 'HOLD') {
    return `Consensus equilibrium: Agents did not reach the minimum agreement threshold. ${agreeing}/${total} agreeing. Capital preserved.`;
  }
  const topReasons = agents
    .filter(a => a.signal === signal)
    .map(a => `${a.agent}: ${a.reason}`)
    .slice(0, 2)
    .join(' | ');
  return `${agreeing}/${total} specialist AI agents aligned on ${signal} (${(confidence * 100).toFixed(0)}% confidence). ${topReasons}`;
}

/**
 * Evaluates multi-agent consensus weighting across DeepSeek (30%), Claude (30%), Gemini (20%), and Hermes (20%).
 * Enforces a strict 70% confidence minimum gate and automated 40% reinvestment allocation.
 */
async function evaluateConsensus(agentResponses) {
  const { deepseek, claude, gemini, hermes } = agentResponses || {};

  const deepseekConf = deepseek?.confidence ?? 0.75;
  const claudeConf = claude?.confidence ?? 0;
  const geminiConf = gemini?.confidence ?? 0;
  const hermesConf = hermes?.confidence ?? 0;

  const aggregateScore = (deepseekConf * 0.3) + (claudeConf * 0.3) + (geminiConf * 0.2) + (hermesConf * 0.2);

  if (aggregateScore >= 0.70) {
    return {
      approved: true,
      action: deepseek?.signal || claude?.recommendedAction || claude?.action || claude?.signal || 'BUY_BTC',
      allocation: "40%",
      aggregateScore: parseFloat(aggregateScore.toFixed(3)),
    };
  }

  return {
    approved: false,
    reason: "Consensus below 70% threshold",
    aggregateScore: parseFloat(aggregateScore.toFixed(3)),
  };
}

module.exports = { runConsensus, AGENT_WEIGHTS, evaluateConsensus };
