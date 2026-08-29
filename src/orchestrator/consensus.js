/**
 * Multi-Agent Consensus Engine
 * Coordinates 6 specialized AI agents, applies dynamic weighting,
 * resolves conflicts, detects hard vetoes, and produces master trading decisions.
 */
const logger = require('../utils/logger');
const claudeAgent = require('../agents/claudeAgent');
const gpt4oAgent = require('../agents/gpt4oAgent');
const geminiAgent = require('../agents/geminiAgent');
const grokAgent = require('../agents/grokAgent');
const perplexityAgent = require('../agents/perplexityAgent');
const hermesAgent = require('../agents/hermesAgent');
const sentimentAgent = require('../agents/youtubeSentimentAgent');

// Credibility weights
const AGENT_WEIGHTS = {
  claude: 0.25,     // Technical analysis & patterns
  gpt4o: 0.20,      // Macro & broad sentiment
  grok: 0.20,       // Real-time news & orderbook imbalance
  gemini: 0.20,     // Cross-validation & risk gate
  perplexity: 0.15, // Fundamentals & on-chain research
  hermes: 0.10,     // Local consensus tie-breaker
  sentiment: 0.10,  // Community media intelligence
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
  logger.info(`[${pair}] Initiating 6-agent parallel consensus pipeline...`);

  // Step 1: Parallel calls to core specialist agents
  const [claudeRes, gpt4oRes, grokRes, perplexityRes, hermesRes, sentimentRes] =
    await Promise.allSettled([
      withTimeout(claudeAgent.getSignal(symbol, marketData), 12000, 'Claude'),
      withTimeout(gpt4oAgent.getSignal(symbol, marketData), 12000, 'GPT-4o'),
      withTimeout(grokAgent.getSignal(symbol, marketData), 12000, 'Grok'),
      withTimeout(perplexityAgent.getSignal(symbol, marketData), 12000, 'Perplexity'),
      withTimeout(hermesAgent.getSignal(symbol, marketData), 10000, 'Hermes'),
      withTimeout(sentimentAgent.getSentimentSignal(symbol), 8000, 'Sentiment'),
    ]);

  const agentOutputs = [];

  function processResult(name, res) {
    if (res.status === 'fulfilled' && res.value) {
      const normSig = normalizeSignal(res.value.signal);
      const conf = Math.max(0, Math.min(1, parseFloat(res.value.confidence) || 0.70));
      agentOutputs.push({
        agent: name,
        signal: normSig,
        confidence: conf,
        reason: res.value.reason || '',
        weight: AGENT_WEIGHTS[name] || 0.15,
        veto_flag: !!res.value.veto_flag,
        veto_reason: res.value.veto_reason || null,
        details: res.value,
      });
      logger.info(`  [${name.padEnd(10)}] -> ${normSig.padEnd(4)} @ ${(conf * 100).toFixed(0)}% | ${res.value.reason?.slice(0, 70)}`);
    } else {
      logger.warn(`  [${name.padEnd(10)}] -> FAILED: ${res.reason?.message || 'Unknown error'}`);
    }
  }

  processResult('claude', claudeRes);
  processResult('gpt4o', gpt4oRes);
  processResult('grok', grokRes);
  processResult('perplexity', perplexityRes);
  processResult('hermes', hermesRes);
  processResult('sentiment', sentimentRes);

  // Step 2: Gemini Cross-Validator receives all peer signals
  let geminiOutput = null;
  try {
    const geminiRaw = await withTimeout(
      geminiAgent.getSignal(symbol, marketData, agentOutputs),
      12000,
      'Gemini'
    );
    const geminiNorm = normalizeSignal(geminiRaw.signal);
    const geminiConf = Math.max(0, Math.min(1, parseFloat(geminiRaw.confidence) || 0.80));
    geminiOutput = {
      agent: 'gemini',
      signal: geminiNorm,
      confidence: geminiConf,
      reason: geminiRaw.reason || 'Cross-validation checks completed',
      weight: AGENT_WEIGHTS.gemini,
      validation_result: geminiRaw.validation_result || 'PASS',
      agent_conflicts_detected: geminiRaw.agent_conflicts_detected || [],
      details: geminiRaw,
    };
    agentOutputs.push(geminiOutput);
    logger.info(`  [${'gemini'.padEnd(10)}] -> ${geminiNorm.padEnd(4)} @ ${(geminiConf * 100).toFixed(0)}% [Cross-Validator: ${geminiOutput.validation_result}]`);
  } catch (err) {
    logger.warn(`  [${'gemini'.padEnd(10)}] -> Cross-validation failed: ${err.message}`);
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

  const consensusReached = agentsAgreeing >= 3 && consensusConfidence >= 0.70;
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

module.exports = { runConsensus, AGENT_WEIGHTS };
