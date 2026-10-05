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
const grokAgent = require('../agents/grokAgent');
const openrouterFreeAgent = require('../agents/openrouterFreeAgent');
const perplexityAgent = require('../agents/perplexityAgent');
const hermesAgent = require('../agents/hermesAgent');
const sentimentAgent = require('../agents/youtubeSentimentAgent');
const defiAgent = require('../agents/defiAgent');
const intelligentSignalsAgent = require('../agents/intelligentSignalsAgent');
const smcAgent = require('../agents/smcAgent');
const providerRotator = require('../agents/providerRotator');
const volatilityRegimeAgent = require('../agents/volatilityRegimeAgent');
// 2026-09-27 (Alan's explicit instruction): technical_lab, technical_daily,
// technical_mtf, evidence_candidates, strategy_learner and traderdev_strategy
// no longer vote — they moved into edgeAggregator.js, which folds all six
// into one non-voting "edge" reading for the Final Judge to weigh. bull_agent
// and bear_agent (deterministic EMA/SMC pattern-hunters) are retired outright
// — bullDebateAgent/bearDebateAgent (already required below) now own the
// "bull/bear" seat in the pipeline. geminiAgent moved out of this file's
// requires too: it's no longer an early cross-validator here, it's called
// once, at the very end, from inside metaEvaluatorAgent.js as the single
// Final Judge — see that file's header.
const edgeAggregator = require('../agents/edgeAggregator');
const healthMonitor = require('../health/agentHealthMonitor');
const { isExcluded } = require('../health/selfHealer');
const { evaluateNegativePatterns } = require('../learning/lossLearner');
const jedaiAdvisor = require('../learning/jedaiAdvisor');
const { loadStrategyMemory } = require('../strategy/strategyMemoryLoader');
const { classifyRegime, REGIMES } = require('../risk/regimeClassifier');
// 2026-09-27 (Alan's approved Phase 2 plan, item 1): the real Bull/Bear/
// Risk-Manager/Meta-Evaluator debate structure — see each file's own
// header and claude/session-2026-09-27-strategyresearcher-live-and-merge-plan.md.
const bullDebateAgent = require('../agents/bullDebateAgent');
const bearDebateAgent = require('../agents/bearDebateAgent');
const riskManagerDebateAgent = require('../agents/riskManagerDebateAgent');
const metaEvaluatorAgent = require('../agents/metaEvaluatorAgent');

// Credibility weights
// 2026-09-27 (Alan's explicit instruction): only three agents cast a real
// vote now that determines candidate direction — claude, openrouter_free
// and oanda_sentiment. bull_agent/bear_agent are retired (their seat is now
// bullDebateAgent/bearDebateAgent, in the debate stage below, which never
// counted toward this vote anyway). gemini no longer votes here at all — it
// runs once at the end as the single Final Judge (metaEvaluatorAgent.js).
// technical_lab/technical_daily/technical_mtf/evidence_candidates/
// strategy_learner/traderdev_strategy don't vote either — see
// edgeAggregator.js, which keeps their old relative weights for its own
// internal "edge" reading. telegram_channel is a data source now, not a
// vote — its raw signal is passed to the Final Judge as context instead.
const AGENT_WEIGHTS = {
  claude: 0.20,
  openrouter_free: 0.10,
  oanda_sentiment: 0.05, // 2026-09-27: OANDA retail Position Book skew (contrarian read on crowded long/short) — OANDA pairs only (never stocks — isOandaPair() already excludes them), small weight, HOLD unless skew is extreme.
  bigdata_sentiment: 0.15, // 2026-09-28 (Alan's explicit instruction): Bigdata.com news/macro sentiment — see src/agents/bigdataAgent.js. Real measured data only, abstains (HOLD, conf 0) on no key/stale cache/too few chunks. Weight matches bigdata_feed.py's own BIGDATA_WEIGHT default.
};

// Confirmed dead/retired as of 2026-09-27 — no processResult(name, ...)
// call exists for any of these, so they never vote and never affect a
// trade today. Kept here (not deleted) purely as a record of what was
// configured but isn't wired into the vote, in case Alan wants one
// deliberately reactivated later. bull_agent/bear_agent/technical_lab/
// technical_daily/technical_mtf/evidence_candidates/strategy_learner/
// traderdev_strategy/telegram_channel/gemini moved here 2026-09-27 when
// the vote was narrowed to claude/openrouter_free/oanda_sentiment — the
// strategy six live on in edgeAggregator.js's own EDGE_WEIGHTS, and gemini
// lives on as the Final Judge in metaEvaluatorAgent.js; they're "dead" only
// as far as THIS file's vote is concerned, not actually unused.
const DEAD_AGENT_WEIGHTS = {
  bull_agent: 0.15,
  bear_agent: 0.15,
  gemini: 0.20,
  technical_lab: 0.20,
  technical_daily: 0.12,
  technical_mtf: 0.09,
  telegram_channel: 0.12,
  traderdev_strategy: 0.15,
  evidence_candidates: 0.15,
  strategy_learner: 0.15,
  deepseek: 0.20,
  smc_agent: 0.20,
  gpt4o: 0.15,
  grok: 0.10,
  defi: 0.15,
  intelligent_signals: 0.15,
  perplexity: 0.05,
  hermes: 0.20,
  sentiment: 0.05,
  provider_rotator: 0.15,
  volatility_regime: 0.08,
  tradingkit: 0.18,
  tradingview_channel: 0.10,
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
  // 2026-10-03: defence in depth for the data-quality gate (the orchestrator already skips such pairs;
  // this also covers dashboard/manual callers). Never let agents vote on bad data.
  if (marketData && marketData.quality && marketData.quality.ok === false) {
    const why = marketData.quality.reasons.join('; ');
    return {
      pair, signal: 'HOLD', confidence: 0, approved_for_execution: false, agentsAgreeing: 0, breakdown: [],
      reasoning: `Data-quality gate: ${why}`, dataQuality: marketData.quality,
    };
  }
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

  // OANDA retail Position Book sentiment wrapper (2026-09-27) — contrarian
  // read on crowded retail positioning. OANDA-covered pairs only; returns an
  // honest HOLD for crypto pairs and whenever positioning isn't extreme.
  async function runOandaSentimentAsAgent() {
    try {
      const oandaSentimentAgent = require('../agents/oandaSentimentAgent');
      return await oandaSentimentAgent.getSignal(symbol, marketData, pair);
    } catch (err) {
      return { signal: 'HOLD', confidence: 0.5, reason: `OANDA sentiment unavailable: ${err.message}` };
    }
  }

  // Bigdata.com news/macro sentiment wrapper (2026-09-28, Alan's explicit
  // instruction) — reads the cache that scripts/bigdata_analyst.py keeps
  // refreshed every 30 min; never calls the API itself, so it can't add
  // latency or spend quota on the fast consensus loop. Abstains cleanly
  // (HOLD, conf 0) with no key / stale cache / too few chunks.
  async function runBigdataSentimentAsAgent() {
    try {
      const bigdataAgent = require('../agents/bigdataAgent');
      return await bigdataAgent.getSignal(symbol, marketData, pair);
    } catch (err) {
      return { signal: 'HOLD', confidence: 0.0, reason: `Bigdata.com unavailable: ${err.message}` };
    }
  }

  // 2026-09-28 (Alan's explicit instruction): the vote is now these four —
  // claude, openrouter_free, oanda_sentiment, bigdata_sentiment
  // (oanda_sentiment only ever applies to OANDA forex/commodities/indices
  // pairs, never stocks — isOandaPair() inside oandaSentimentAgent.js
  // already excludes them, so no extra check is needed here; bigdata_sentiment
  // abstains on its own whenever it lacks real data — see bigdataAgent.js).
  // Telegram is fetched below as CONTEXT for the Final Judge, not a vote.
  // The six strategy agents run in parallel via edgeAggregator.getEdge() —
  // also not a vote, see that module. Bull/Bear/Gemini all still take part
  // in this trade's decision, just later in the pipeline (the debate stage
  // and the Final Judge below).
  const [claudeRes, openrouterFreeRes, oandaSentimentRes, bigdataSentimentRes, edgeResult] = await Promise.allSettled([
    timedAgent('claude',              withTimeout(claudeAgent.getSignal(symbol, marketData),          18000, 'Claude')),
    timedAgent('openrouter_free',     withTimeout(openrouterFreeAgent.getSignal(symbol, marketData),   15000, 'OpenRouterFree')),
    timedAgent('oanda_sentiment',     withTimeout(runOandaSentimentAsAgent(),                           6000, 'OandaSentiment')),
    timedAgent('bigdata_sentiment',   withTimeout(runBigdataSentimentAsAgent(),                         5000, 'BigdataSentiment')),
    withTimeout(edgeAggregator.getEdge(symbol, marketData),                                            16000, 'EdgeAggregator'),
  ]);
  const telegramContext = (() => {
    const t = runTelegramSignalAsAgent();
    return t.signal !== 'HOLD' ? `${t.reason || ''}`.trim() : null;
  })();
  const edge = edgeResult.status === 'fulfilled' ? edgeResult.value : { edgeSignal: 'HOLD', edgeScore: 0, contributingCount: 0, summary: 'Edge aggregator unavailable this cycle.' };

  // Record health outcomes for every agent
  const agentResults = {
    claude: claudeRes,
    openrouter_free: openrouterFreeRes,
    oanda_sentiment: oandaSentimentRes,
    bigdata_sentiment: bigdataSentimentRes,
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

      // Evidence-scaled vote (2026-09-24): agents that report a measured evidence tier
      // (e.g. evidence_candidates) get x0.5..x1.5. Only changes vote weight, never risk limits.
      const vm = Number(res.value.voteMultiplier);
      if (Number.isFinite(vm) && vm > 0) {
        effectiveWeight = parseFloat((effectiveWeight * Math.max(0.5, Math.min(1.5, vm))).toFixed(3));
      }

      // 2026-09-27 (Alan's explicit instruction): claudeAgent.js has no real
      // API key configured (Alan uses Claude via Pro/Max, not the API) and
      // silently falls back to a rule-based heuristic simulator every cycle.
      // It was weighted the same as a genuine Claude opinion (0.20 in
      // AGENT_WEIGHTS) and shown in vote breakdowns as if it were one.
      // Discount it here so it's honestly weighted as a heuristic agent
      // rather than silently counted as real AI reasoning.
      if (name === 'claude' && res.value.usingHeuristicFallback) {
        effectiveWeight = parseFloat((effectiveWeight * 0.5).toFixed(3));
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

  processResult('claude', claudeRes);
  processResult('openrouter_free', openrouterFreeRes);
  processResult('oanda_sentiment', oandaSentimentRes);
  processResult('bigdata_sentiment', bigdataSentimentRes);

  // 2026-09-27 (Alan's explicit instruction): Gemini no longer runs here as
  // an early cross-validator inside the vote — it's called exactly once,
  // later, as the single Final Judge (metaEvaluatorAgent.js), after it can
  // also see the Bull/Bear debate and the strategy edge reading. Removing
  // this early call also means Gemini's daily free-tier quota is only spent
  // once per candidate trade instead of twice.

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

  // ─────────────────────────────────────────────────────────────────────
  // BULL/BEAR/RISK-MANAGER DEBATE + META-EVALUATOR (2026-09-27, Alan's
  // approved Phase 2 plan, item 1: "1 bull/bear build configure impliment"
  // — see claude/session-2026-09-27-strategyresearcher-live-and-merge-plan.md
  // and the CGX formula in claude/strategy-research-findings.md). This is
  // ADDITIVE, not a replacement of the 12-agent weighted vote above:
  // bull_agent/bear_agent keep voting as independent technical
  // pattern-hunters exactly as before. This new stage only runs once that
  // vote has already produced a BUY/SELL candidate, and specifically
  // argues FOR/AGAINST taking THAT trade — a real debate, not another raw
  // vote — using OpenRouter's free-model pool (Bull) and local
  // Ollama/Hermes (Bear), plus a deterministic Risk Manager veto reading
  // the SAME portfolio-exposure cap riskGate.js already enforces. It can
  // only ever make a trade MORE conservative: a hard veto forces HOLD, and
  // its confidence adjustment is capped at ±12% either way — it can never
  // bypass MIN_CONFIDENCE or the majority-agreement floor further below.
  let debateVeto = false;
  let debateVetoReason = null;
  let debateSummary = null; // 2026-10-03: handed to the predictor agent (runs after the debate, before the risk gate)
  if (finalSignal !== 'HOLD') {
    try {
      const candidate = {
        direction: finalSignal,
        rawConfidence: consensusConfidence,
        reason: generateConsensusReasoning(finalSignal, consensusConfidence, agentsAgreeing, totalAgents, agentOutputs),
      };
      const [bullDebate, bearDebate] = await Promise.all([
        bullDebateAgent.debate(symbol, marketData, candidate),
        bearDebateAgent.debate(symbol, marketData, candidate),
      ]);
      const riskManagerDebate = riskManagerDebateAgent.run(symbol);
      debateSummary = {
        bullConfidence: Number(bullDebate?.confidence), bearConfidence: Number(bearDebate?.confidence),
        bearVeto: !!bearDebate?.veto, riskVeto: !!riskManagerDebate?.veto,
        bullReason: String(bullDebate?.reason || '').slice(0, 160), bearReason: String(bearDebate?.reason || '').slice(0, 160),
      };
      const panel = {
        claude: agentOutputs.find(a => a.agent === 'claude'),
        openrouter_free: agentOutputs.find(a => a.agent === 'openrouter_free'),
        oanda_sentiment: agentOutputs.find(a => a.agent === 'oanda_sentiment'),
      };
      const metaResult = await metaEvaluatorAgent.evaluate(symbol, marketData, candidate, {
        bull: bullDebate,
        bear: bearDebate,
        riskManager: riskManagerDebate,
        panel,
        edge,
        telegramContext,
      });

      if (metaResult.vetoed) {
        debateVeto = true;
        debateVetoReason = `Debate veto: ${metaResult.reason}`;
        logger.warn(`[${pair}] 🐂🐻 ${debateVetoReason}`);
      } else {
        const before = consensusConfidence;
        consensusConfidence = Math.max(0.30, Math.min(0.98, parseFloat((consensusConfidence + metaResult.confidenceDelta).toFixed(3))));
        logger.info(`[${pair}] 🐂🐻 Debate: ${(before * 100).toFixed(0)}% -> ${(consensusConfidence * 100).toFixed(0)}% (${metaResult.reason})`);
      }
    } catch (err) {
      // A debate-stage failure must never silently block or corrupt a
      // trade decision — log and continue with the raw vote unchanged.
      logger.warn(`[${pair}] Bull/Bear debate stage error (non-fatal, raw vote unchanged): ${err.message}`);
    }
  }

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

  // JedAI Advisor (2026-09-27, Alan's request): automatic real-time similarity
  // match against past win/loss trade memory, using JedAI's own validated
  // trigram-Jaccard technique (see tools/jedai-match's TradeMatcher.java and
  // src/learning/jedaiAdvisor.js). Purely advisory -- nudges confidence the
  // same way the negative-pattern penalty above does, never bypasses
  // MIN_CONFIDENCE or the majority gate in riskGate.js. Runs automatically
  // every cycle; no manual script run required.
  if (!patternVeto && finalSignal !== 'HOLD') {
    try {
      const jedai = jedaiAdvisor.evaluateSimilarity(symbol, finalSignal, marketData, marketData?.btcBenchmark);
      if (jedai.match && jedai.confidenceDelta !== 0) {
        consensusConfidence = Math.max(0.30, Math.min(0.98, parseFloat((consensusConfidence + jedai.confidenceDelta).toFixed(3))));
        const dirWord = jedai.confidenceDelta < 0 ? '-' : '+';
        logger.info(
          `[${pair}] 🔎 JedAI Advisor: ${dirWord}${Math.abs(jedai.confidenceDelta * 100).toFixed(1)}% -> ${(consensusConfidence * 100).toFixed(0)}% `
          + `(${(jedai.match.similarity * 100).toFixed(0)}% similar to past ${jedai.match.outcome}: ${jedai.match.diagnostic})`
        );
      }
    } catch (_) {}
  }

  // 2026-09-27 (Alan's explicit instruction): the majority-agent-agreement
  // requirement is removed here and in riskGate.js's own majority check —
  // with only 3 voting agents left (claude, openrouter_free, oanda_sentiment)
  // plus the Gemini Final Judge and Bull/Bear debate deciding the real
  // gate, a headcount-based majority no longer means what it used to.
  // agentsAgreeing/totalAgents are still computed and reported for the
  // dashboard, just no longer gate execution here.
  const MIN_CONSENSUS_CONFIDENCE = parseFloat(process.env.CONSENSUS_MIN_CONFIDENCE || '0.45');
  const consensusReached = !patternVeto && !debateVeto && consensusConfidence >= MIN_CONSENSUS_CONFIDENCE;
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
    veto_triggered: patternVeto || debateVeto,
    veto_reason: patternVetoReason || debateVetoReason,
    agentsAgreeing,
    totalAgents,
    breakdown: agentOutputs,
    debate: debateSummary,
    reasoning: patternVeto
      ? patternVetoReason
      : debateVeto
        ? debateVetoReason
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
