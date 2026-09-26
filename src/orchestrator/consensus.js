/**
 * Multi-Agent Consensus Engine
 * Coordinates specialized AI agents (Claude, GPT-4o, DeepSeek R1/V3, Gemini,
 * Grok, OpenRouter Free Tier, Perplexity, Hermes, and YouTube Sentiment),
 * applies dynamic weighting, resolves conflicts, detects hard vetoes, and produces master trading decisions.
 *
 * v2: providerRotator added as 13th parallel agent — runs 5 free/subscription
 * models (DeepSeek R1, Llama 3.3, Gemini Flash, Qwen, Mistral + Gemini Pro + Ollama)
 * and synthesises a rotated consensus. This ensures 24/7 uptime even when
 * primary paid API keys are rate-limited.
 *
 * v3 (2026-09-06): volatilityRegimeAgent added as 14th agent. It never votes
 * BUY/SELL (ATR/BB-width tell you magnitude of movement, not direction), so
 * it can't force a trade or count toward agentsAgreeing — it's a low-weight
 * advisory signal only. See src/agents/volatilityRegimeAgent.js.
 *
 * v4 (2026-09-15): traderDevAgent added — queries TraderDev's public strategy
 * leaderboard (240K+ strategies, 1M+ backtests) for crowd-consensus signals.
 * Free, no API key required. Cached 5 min per symbol.
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
const bullAgent = require('../agents/bullAgent');
const bearAgent = require('../agents/bearAgent');
const providerRotator = require('../agents/providerRotator');
const volatilityRegimeAgent = require('../agents/volatilityRegimeAgent');
const technicalLabAgent = require('../agents/technicalLabAgent');
const technicalDailyAgent = require('../agents/technicalDailyAgent');
const traderDevAgent = require('../agents/traderDevAgent');
const healthMonitor = require('../health/agentHealthMonitor');
const { isExcluded } = require('../health/selfHealer');
const { evaluateNegativePatterns } = require('../learning/lossLearner');
const { loadStrategyMemory } = require('../strategy/strategyMemoryLoader');
const { classifyRegime, REGIMES } = require('../risk/regimeClassifier');

// Credibility weights
const AGENT_WEIGHTS = {
  bull_agent: 0.15,
  bear_agent: 0.15,
  deepseek: 0.20,
  claude: 0.20,
  smc_agent: 0.20,
  strategy_learner: 0.15,
  gpt4o: 0.15,
  gemini: 0.20,
  openrouter_free: 0.10,
  grok: 0.10,
  defi: 0.15,
  intelligent_signals: 0.15,
  perplexity: 0.05,
  hermes: 0.20,
  sentiment: 0.05,
  provider_rotator: 0.15,
  volatility_regime: 0.08,
  technical_lab: 0.20,  // 2026-09-14 merge: walk-forward-validated EMA50/100+VWAP strategy (ETH only) from F:\aitradingagent2 — see claude/session-2026-09-14-merge-report.md
  technical_daily: 0.12,  // 2026-09-14: own-OHLCV (ccxt, no Alpha Vantage quota) 3-cycle-robust daily EMA/RSI/MACD/ATR strategy, BTC/ETH/SOL/AVAX/ARB (OP/CRO disabled, no real edge/insufficient sample) — lower weight than technical_lab because 3-cycle robustness is a real but slightly weaker validation than genuine out-of-sample walk-forward. See src/agents/technicalConsensusAgent.js.
  tradingkit: 0.18,   // TradingKit strategy signals — real market data
  telegram_channel: 0.12, // Live indicator channel signals
  traderdev_strategy: 0.15, // TraderDev leaderboard crowd-consensus (240K+ backtested strategies)
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
  const currentRegime = classifyRegime(marketData);
  logger.info(`[${pair}] Initiating multi-agent parallel consensus pipeline (with DeepSeek R1 & OpenRouter Free Tier)... [Regime: ${currentRegime}]`);

  // Load empirical agent accuracy track records for dynamic consensus weighting
  const strategyMemory = loadStrategyMemory();
  const agentAccuracy = strategyMemory?.agentAccuracy || {};

  // Step 1: Parallel calls to core specialist agents (with per-agent health timing)
  const agentCallStart = Date.now();
  const agentLatencies = {};
  async function timedAgent(name, promise) {
    const start = Date.now();
    try {
      const val = await promise;
      agentLatencies[name] = Date.now() - start;
      return val;
    } catch (err) {
      agentLatencies[name] = Date.now() - start;
      throw err;
    }
  }

  // providerRotator wrapper
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

  // TradingKit signal wrapper — real market data signals
  async function runTradingKitAsAgent() {
    const { fetchSignal } = require('../data/tradingKitFeed');
    const tk = await fetchSignal(pair);
    if (!tk) return { signal: 'HOLD', confidence: 0.5, reason: 'TradingKit unavailable' };
    return {
      signal:     normalizeSignal(tk.direction || tk.signal || 'HOLD'),
      confidence: parseFloat(tk.confidence || 0.70),
      reason:     tk.reasoning || tk.reason || `TradingKit ${tk.strategy || 'smart_money'} signal`,
      model_used: 'tradingkit-api',
      provider:   'tradingkit',
    };
  }

  // Telegram channel signals wrapper
  function runTelegramSignalAsAgent() {
    const tgSig = marketData.telegramSignal;
    if (!tgSig || !tgSig.action) return { signal: 'HOLD', confidence: 0.5, reason: 'No Telegram signal' };
    return {
      signal:     normalizeSignal(tgSig.action),
      confidence: parseFloat(tgSig.confidence || 0.72),
      reason:     `Channel: ${tgSig.channel || 'indicator'} — ${(tgSig.raw || '').slice(0, 60)}`,
      model_used: 'telegram-channel',
      provider:   'telegram_channel',
    };
  }

  const [
    bullAgentRes,
    bearAgentRes,
    claudeRes,
    openrouterFreeRes,
    strategyLearnerRes,
    tradingKitRes,
    telegramRes,
    technicalLabRes,
    technicalDailyRes,
    traderDevRes,
  ] = await Promise.allSettled([
    timedAgent('bull_agent',          withTimeout(bullAgent.getSignal(symbol, marketData),            5000,  'BullAgent')),
    timedAgent('bear_agent',          withTimeout(bearAgent.getSignal(symbol, marketData),            5000,  'BearAgent')),
    timedAgent('claude',              withTimeout(claudeAgent.getSignal(symbol, marketData),              10000, 'Claude')),
    timedAgent('openrouter_free',     withTimeout(openrouterFreeAgent.getSignal(symbol, marketData),      10000, 'OpenRouterFree')),
    timedAgent('strategy_learner',    withTimeout(strategyLearningAgent.getSignal(symbol, marketData),     5000, 'StrategyLearner')),
    timedAgent('tradingkit',          withTimeout(runTradingKitAsAgent(),                                  8000, 'TradingKit')),
    timedAgent('telegram_channel',    Promise.resolve(runTelegramSignalAsAgent())),
    timedAgent('technical_lab',       withTimeout(technicalLabAgent.getSignal(symbol, marketData),         8000, 'TechnicalLab')),
    timedAgent('technical_daily',     withTimeout(technicalDailyAgent.getSignal(symbol, marketData),       8000, 'TechnicalDaily')),
    timedAgent('traderdev_strategy',  withTimeout(traderDevAgent.getSignal(symbol, marketData),            6000, 'TraderDev')),
  ]);

  // Record health outcomes for every agent
  const agentResults = {
    bull_agent: bullAgentRes,
    bear_agent: bearAgentRes,
    claude: claudeRes,
    openrouter_free: openrouterFreeRes,
    strategy_learner: strategyLearnerRes,
    tradingkit: tradingKitRes,
    telegram_channel: telegramRes,
    technical_lab: technicalLabRes,
    technical_daily: technicalDailyRes,
    traderdev_strategy: traderDevRes,
  };
  for (const [name, res] of Object.entries(agentResults)) {
    const latency = agentLatencies[name] || 0;
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

      // Self-Learning Dynamic Weight Scaling:
      // When an agent has >= 3 recorded trades in strategy memory, scale its weight
      // based on its empirical rolling accuracy relative to the 70% benchmark.
      const baseWeight = AGENT_WEIGHTS[name] || 0.10;
      let effectiveWeight = baseWeight;
      const acc = agentAccuracy[name];
      if (acc && acc.total >= 3) {
        const hitRate = acc.accuracy;
        const multiplier = Math.max(0.50, Math.min(1.60, hitRate / 0.70));
        effectiveWeight = parseFloat((baseWeight * multiplier).toFixed(3));
      }

      // Regime-Aware Dynamic Arbitration:
      // In strong directional trends, boost the aligned specialist and discount counter-trend specialist
      if (currentRegime === REGIMES.STRONG_BULL_TREND) {
        if (name === 'bull_agent') effectiveWeight = parseFloat((effectiveWeight * 1.40).toFixed(3));
        if (name === 'bear_agent') effectiveWeight = parseFloat((effectiveWeight * 0.60).toFixed(3));
      } else if (currentRegime === REGIMES.STRONG_BEAR_TREND) {
        if (name === 'bear_agent') effectiveWeight = parseFloat((effectiveWeight * 1.40).toFixed(3));
        if (name === 'bull_agent') effectiveWeight = parseFloat((effectiveWeight * 0.60).toFixed(3));
      }

      agentOutputs.push({
        agent: name,
        signal: normSig,
        confidence: conf,
        reason: res.value.reason || '',
        weight: effectiveWeight,
        veto_flag: !!res.value.veto_flag,
        veto_reason: res.value.veto_reason || null,
        model_used: res.value.model_used || null,
        provider: res.value.provider || null,
        details: res.value,
        health: { status: health.status, latencyMs: health.latencyMs, errorRate: health.errorRate },
      });
      logger.info(`  [${name.padEnd(16)}] -> ${normSig.padEnd(4)} @ ${(conf * 100).toFixed(0)}% (wt: ${effectiveWeight}) | [${health.status}] ${res.value.reason?.slice(0, 50)}`);
    } else {
      const isExc = res.reason?.message === 'excluded';
      logger.warn(`  [${name.padEnd(16)}] -> ${isExc ? 'EXCLUDED' : 'FAILED'}: ${res.reason?.message || 'Unknown error'}`);
    }
  }

  processResult('bull_agent', bullAgentRes);
  processResult('bear_agent', bearAgentRes);
  processResult('claude', claudeRes);
  processResult('openrouter_free', openrouterFreeRes);
  processResult('strategy_learner', strategyLearnerRes);
  processResult('tradingkit', tradingKitRes);
  processResult('telegram_channel', telegramRes);
  processResult('technical_lab', technicalLabRes);
  processResult('technical_daily', technicalDailyRes);
  processResult('traderdev_strategy', traderDevRes);

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
    logger.info(`  [${'gemini'.padEnd(16)}] -> ⚡ FAST-TRACK (${dominantAgree.length}/${preFastTrack.length} directional agents @ ${(avgFastConf*100).toFixed(0)}% avg — Gemini skipped)`);
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

      let geminiWeight = AGENT_WEIGHTS.gemini;
      const geminiAcc = agentAccuracy.gemini;
      if (geminiAcc && geminiAcc.total >= 3) {
        const mult = Math.max(0.50, Math.min(1.60, geminiAcc.accuracy / 0.70));
        geminiWeight = parseFloat((geminiWeight * mult).toFixed(3));
      }

      geminiOutput = {
        agent: 'gemini',
        signal: geminiNorm,
        confidence: geminiConf,
        reason: geminiRaw.reason || 'Cross-validation checks completed',
        weight: geminiWeight,
        validation_result: geminiRaw.validation_result || 'PASS',
        agent_conflicts_detected: geminiRaw.agent_conflicts_detected || [],
        details: geminiRaw,
        health: { status: health.status, latencyMs: health.latencyMs },
      };
      agentOutputs.push(geminiOutput);
      logger.info(`  [${'gemini'.padEnd(16)}] -> ${geminiNorm.padEnd(4)} @ ${(geminiConf * 100).toFixed(0)}% (wt: ${geminiWeight}) [Cross-Validator: ${geminiOutput.validation_result}]`);
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
  let consensusConfidence = Math.min(
    0.98,
    parseFloat((rawConfidence * 0.6 + agreementRatio * 0.4).toFixed(3))
  );

  // Check Self-Learning Negative Pattern Memory (learned from lost trades)
  let patternVeto = false;
  let patternVetoReason = null;
  if (finalSignal !== 'HOLD') {
    try {
      const negCheck = evaluateNegativePatterns(symbol, finalSignal, marketData, marketData?.btcBenchmark);
      if (negCheck.hasNegativePatternMatch) {
        if (negCheck.vetoRecommended) {
          patternVeto = true;
          patternVetoReason = `Self-Learning Negative Pattern Veto: ${negCheck.reason}`;
          logger.warn(`[${pair}] 🛑 ${patternVetoReason}`);
        } else {
          consensusConfidence = Math.max(0.35, parseFloat((consensusConfidence - negCheck.confidencePenalty).toFixed(3)));
          logger.info(`[${pair}] 🧠 Self-Learning Penalty: -${(negCheck.confidencePenalty * 100).toFixed(0)}% -> ${(consensusConfidence * 100).toFixed(0)}% (${negCheck.reason})`);
        }
      }
    } catch (_) {}
  }

  // Require minimum agent agreement (default aligned with MIN_AGENTS in .env)
  const MIN_AGENTS_AGREEING = parseInt(process.env.CONSENSUS_MIN_AGENTS_AGREEING || process.env.MIN_AGENTS || '2', 10);
  const MIN_CONSENSUS_CONFIDENCE = parseFloat(process.env.CONSENSUS_MIN_CONFIDENCE || '0.45');
  const consensusReached = !patternVeto && agentsAgreeing >= MIN_AGENTS_AGREEING && consensusConfidence >= MIN_CONSENSUS_CONFIDENCE;
  const approvedForExecution = consensusReached && finalSignal !== 'HOLD';

  const synthesis = {
    symbol,
    pair,
    timestamp: new Date().toISOString(),
    signal: finalSignal,
    regime: currentRegime,
    confidence: consensusConfidence,
    weightedScore: parseFloat(avgScore.toFixed(3)),
    consensus_reached: consensusReached,
    approved_for_execution: approvedForExecution,
    veto_triggered: patternVeto,
    veto_reason: patternVetoReason,
    agentsAgreeing,
    totalAgents,
    breakdown: agentOutputs,
    reasoning: patternVeto
      ? patternVetoReason
      : generateConsensusReasoning(finalSignal, consensusConfidence, agentsAgreeing, totalAgents, agentOutputs),
  };

  logger.info(
    `[${pair}] Master Consensus: ${finalSignal} @ ${(consensusConfidence * 100).toFixed(1)}% (${agentsAgreeing}/${totalAgents} agents agreeing) -> ${approvedForExecution ? '✅ APPROVED' : '⚠️ HOLD/SKIPPED'}`
  );

  // ───────────────────────────────────────────────────────────────────────
  // 2026-09-15: publish every agent's individual vote so the dashboard can
  // show WHO voted and who stayed silent. Added because an audit found 18 of
  // 23 agents timing out with no visible symptom — the only clue was a log
  // line reading "1/11 agents agreeing". A per-agent view makes a degraded
  // roster obvious at a glance instead of something you infer from a ratio.
  //
  // Purely additive: wrapped in try/catch and a guard, so a dashboard that
  // isn't running, or a write that fails, can never affect a trading decision.
  // ───────────────────────────────────────────────────────────────────────
  try {
    const votePayload = {
      type: 'agent_votes',
      pair,
      timestamp: synthesis.timestamp,
      finalSignal,
      confidence: consensusConfidence,
      agentsAgreeing,
      totalAgents,
      approvedForExecution,
      vetoTriggered: patternVeto,
      votes: (agentOutputs || []).map((a) => ({
        name: a.name || a.agent || a.provider || 'unknown',
        signal: a.signal || 'HOLD',
        confidence: typeof a.confidence === 'number' ? a.confidence : 0,
        weight: typeof a.weight === 'number' ? a.weight : 0,
        agreed: a.signal === finalSignal && a.signal !== 'HOLD',
        reason: String(a.reason || '').slice(0, 180),
      })),
    };

    if (global.broadcastDashboardEvent) global.broadcastDashboardEvent(votePayload);

    // Also persist, so a dashboard opened later shows the latest state rather
    // than an empty panel until the next cycle fires.
    const fs = require('fs');
    const path = require('path');
    const outPath = path.join(__dirname, '..', '..', 'data', 'latest_agent_votes.json');
    const existing = (() => {
      try { return JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch (_) { return { pairs: {} }; }
    })();
    existing.pairs = existing.pairs || {};
    existing.pairs[pair] = votePayload;
    existing.updatedAt = new Date().toISOString();
    fs.writeFileSync(outPath, JSON.stringify(existing, null, 2));
  } catch (err) {
    logger.warn(`[${pair}] agent-vote publish failed (non-fatal): ${err.message}`);
  }

  return synthesis;
}

/**
 * Lightweight consensus gate over a plain map of agent responses.
 *
 * Unlike runConsensus() — which fans out to every live LLM agent — this is a
 * pure scorer: given already-collected `{ agentName: { confidence, recommendedAction? } }`
 * responses, it averages the confidences and approves when the aggregate clears
 * the 70% conviction bar. Used by the orchestrator's fast path and by tests.
 *
 * @param {Object<string, {confidence?: number, recommendedAction?: string}>} agentResponses
 * @returns {{approved: boolean, aggregateScore: number, action?: string, allocation?: string, reason?: string}}
 */
function evaluateConsensus(agentResponses = {}) {
  const APPROVAL_THRESHOLD = 0.70;

  const responses = Object.values(agentResponses || {});
  const scores = responses
    .map(r => (r && typeof r.confidence === 'number' ? r.confidence : null))
    .filter(n => n !== null);

  const aggregateScore = scores.length
    ? parseFloat((scores.reduce((sum, n) => sum + n, 0) / scores.length).toFixed(4))
    : 0;

  if (aggregateScore < APPROVAL_THRESHOLD) {
    return {
      approved: false,
      aggregateScore,
      reason: 'Consensus below 70% threshold',
    };
  }

  const action =
    responses.find(r => r && r.recommendedAction)?.recommendedAction || 'BUY_BTC';

  return {
    approved: true,
    aggregateScore,
    action,
    // Mirrors the profit allocator's 40% reinvest tranche — the standard
    // deployable slice for a cleared-threshold signal.
    allocation: '40%',
  };
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

module.exports = { runConsensus, evaluateConsensus, AGENT_WEIGHTS };
