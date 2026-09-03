/**
 * Multi-Agent Consensus Engine
 * Coordinates 8 specialized AI agents (Claude, GPT-4o, DeepSeek R1/V3, Gemini,
 * Grok, OpenRouter Free Tier, Perplexity, Hermes, and YouTube Sentiment),
 * applies dynamic weighting, resolves conflicts, detects hard vetoes, and produces master trading decisions.
 * 
 * v2: providerRotator added as 13th parallel agent — runs 5 free/subscription
 * models (DeepSeek R1, Llama 3.3, Gemini Flash, Qwen, Mistral + Gemini Pro + Ollama)
 * and synthesises a rotated consensus. This ensures 24/7 uptime even when
 * primary paid API keys are rate-limited.
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
const providerRotator = require('../agents/providerRotator');
const healthMonitor = require('../health/agentHealthMonitor');
const { isExcluded } = require('../health/selfHealer');

// Credibility weights
const AGENT_WEIGHTS = {
  deepseek: 0.20,        // Quantitative SMC & reasoning
  claude: 0.20,          // Technical analysis & chart patterns
  smc_agent: 0.20,       // Casper SMC & LuxAlgo Order Blocks
  strategy_learner: 0.15,// Backtested PineScript & Adaptive Technicals
  gpt4o: 0.15,           // Macro & institutional sentiment
  gemini: 0.20,          // Cross-validation & risk gate (Ollama-powered)
  openrouter_free: 0.10, // Zero-cost multi-model free router
  grok: 0.10,            // Real-time news & orderbook imbalance
  defi: 0.15,            // Deterministic high-probability DeFi metrics
  intelligent_signals: 0.15, // Machine learning & feature engineering feeds
  perplexity: 0.05,      // Fundamentals & tokenomics
  hermes: 0.20,          // Local Ollama consensus validator (free, private)
  sentiment: 0.05,       // Media alpha & YouTube intelligence
  provider_rotator: 0.15,// 24/7 rotation: free OpenRouter + Gemini Pro + Ollama fallback
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

  // providerRotator wrapper — converts rotated consensus output to standard agent signal format
  async function runRotatorAsAgent() {
    const result = await providerRotator.runRotatedConsensus(symbol, marketData);
    return {
      signal: result.signal,
      confidence: result.confidence,
      reason: `ProviderRotator (${result.agentsAgreeing} rotated agents): ${result.breakdown?.map(b => b.provider).join(', ') || 'free+sub pool'}`,
      model_used: 'rotation-pool',
      provider: 'provider_rotator',
    };
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
    providerRotatorRes,
  ] = await Promise.allSettled([
    // Tiered timeouts: local and cloud agents with automated quantitative fallbacks
    timedAgent('deepseek',            withTimeout(deepseekAgent.getSignal(symbol, marketData),            10000, 'DeepSeek')),
    timedAgent('claude',              withTimeout(claudeAgent.getSignal(symbol, marketData),              10000, 'Claude')),
    timedAgent('gpt4o',               withTimeout(gpt4oAgent.getSignal(symbol, marketData),               10000, 'GPT-4o')),
    timedAgent('grok',                withTimeout(grokAgent.getSignal(symbol, marketData),                10000, 'Grok')),
    timedAgent('openrouter_free',     withTimeout(openrouterFreeAgent.getSignal(symbol, marketData),      10000, 'OpenRouterFree')),
    timedAgent('perplexity',          withTimeout(perplexityAgent.getSignal(symbol, marketData),           10000, 'Perplexity')),
    timedAgent('hermes',              withTimeout(hermesAgent.getSignal(symbol, marketData),              30000,  'Hermes')),   // local Ollama ~18s inference
    timedAgent('sentiment',           withTimeout(sentimentAgent.getSentimentSignal(symbol),               5000,  'Sentiment')), // cached — fast
    timedAgent('defi',                withTimeout(defiAgent.getSignal(symbol, marketData),                 5000,  'DeFi')),
    timedAgent('intelligent_signals', withTimeout(intelligentSignalsAgent.getSignal(symbol, marketData),     5000,  'IntelligentSignals')),
    timedAgent('smc_agent',           withTimeout(smcAgent.getSignal(symbol, marketData),                   5000,  'SMCAgent')),
    timedAgent('strategy_learner',    withTimeout(strategyLearningAgent.getSignal(symbol, marketData),      5000,  'StrategyLearner')),
    timedAgent('provider_rotator',    withTimeout(runRotatorAsAgent(),                                     35000,  'ProviderRotator')), // 5 agents in parallel internally
  ]);

  // Record health outcomes for every agent
  const agentResults = {
    deepseek: deepseekRes, claude: claudeRes, gpt4o: gpt4oRes,
    grok: grokRes, openrouter_free: openrouterFreeRes,
    perplexity: perplexityRes, hermes: hermesRes, sentiment: sentimentRes,
    defi: defiRes, intelligent_signals: intelligentSignalsRes, smc_agent: smcRes,
    strategy_learner: strategyLearnerRes, provider_rotator: providerRotatorRes,
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
  processResult('provider_rotator', providerRotatorRes);

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
        30000,  // Ollama local ~18s inference on this hardware
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
    // Prevent passive fallback HOLD signals from suppressing directional BUY/SELL consensus
    totalWeight += s.signal === 'HOLD' ? effectiveWeight * 0.35 : effectiveWeight;
  }

  const avgScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
  let finalSignal = 'HOLD';
  if (avgScore >= 0.18) finalSignal = 'BUY';
  else if (avgScore <= -0.18) finalSignal = 'SELL';

  const agreeingAgents = agentOutputs.filter(a => a.signal === finalSignal && a.signal !== 'HOLD');
  const agentsAgreeing = agreeingAgents.length;
  const totalAgents = agentOutputs.length;

  // Scale consensus confidence by agent agreement ratio and score magnitude
  const rawConfidence = Math.abs(avgScore);
  const directionalTotal = agentOutputs.filter(a => a.signal !== 'HOLD').length;
  const agreementRatio = directionalTotal > 0 ? agentsAgreeing / directionalTotal : (totalAgents > 0 ? agentsAgreeing / totalAgents : 0);
  const consensusConfidence = Math.min(
    0.98,
    parseFloat((rawConfidence * 0.6 + agreementRatio * 0.4).toFixed(3))
  );

  // Require a real majority, not just 2 stragglers agreeing at a low bar.
  // Tightened 2026-09-03: was agentsAgreeing >= 2 && consensusConfidence >= 0.28
  // (out of 13 agents, that let 2 agree at 28% confidence trigger a trade).
  const MIN_AGENTS_AGREEING = parseInt(process.env.CONSENSUS_MIN_AGENTS_AGREEING || '5', 10);
  const MIN_CONSENSUS_CONFIDENCE = parseFloat(process.env.CONSENSUS_MIN_CONFIDENCE || '0.45');
  const consensusReached = agentsAgreeing >= MIN_AGENTS_AGREEING && consensusConfidence >= MIN_CONSENSUS_CONFIDENCE;
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
