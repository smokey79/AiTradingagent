/**
 * src/agents/metaEvaluatorAgent.js — upgraded 2026-09-27 (Alan's explicit
 * instruction): "have a single AI analyse what the others are saying to
 * give a final confidence score which is what goes to risk gate", then
 * corrected same session: "gemini can analyse better, have it analyse and
 * crosscheck the other votes and award a final confidence."
 *
 * Previously this synthesized the Bull/Bear/Risk-Manager debate plus the
 * raw weighted vote using a deterministic CGX (Consensus-Gated Execution)
 * formula only. It is now Gemini's job: this module hands geminiAgent.js
 * (already the system's existing cross-validator, with its own tested
 * Gemini-API -> OpenRouter -> local Ollama -> Ollama Cloud -> heuristic
 * fallback chain) EVERYTHING relevant to this candidate trade — the live
 * AI panel (Claude/OpenRouter/OANDA sentiment), the Bull/Bear debate, the
 * six-strategy "edge" reading (src/agents/edgeAggregator.js), and any live
 * Telegram channel context — as its peerSignals input, and takes Gemini's
 * returned confidence as the ONE final score. That's the number
 * riskGate.js's MIN_CONFIDENCE check now runs against, in place of a
 * majority vote. Gemini previously also ran as a separate early
 * cross-validator inside consensus.js's initial vote; that step is now
 * removed so Gemini is called exactly once per candidate, here, seeing the
 * full picture including the debate — not twice, and not before the
 * debate exists to see.
 *
 * Safety bounds are unchanged from the original CGX design: Gemini can
 * move confidence within ±DEBATE_MAX_CONFIDENCE_DELTA (default 12%) of the
 * panel's own raw confidence, or force a veto (HOLD) — either because the
 * Bear debate/Risk Manager already vetoed, or because Gemini itself comes
 * back with a different signal than the proposed direction (treated as a
 * strong disagreement, not a redirect — this system only ever gets MORE
 * conservative here, never picks a new direction on Gemini's say-so
 * alone). It never bypasses MIN_CONFIDENCE. If the Gemini call path fails
 * outright (all its own fallbacks exhausted, which is rare), this falls
 * back to the original deterministic CGX formula rather than blocking the
 * cycle — same fail-safe pattern as every other AI call in this pipeline.
 */
'use strict';
const logger = require('../utils/logger');
const geminiAgent = require('./geminiAgent');

const MAX_DELTA = Number(process.env.DEBATE_MAX_CONFIDENCE_DELTA || 0.12);

// Original CGX (Consensus-Gated Execution) formula — kept as the automatic
// fallback for the rare case where geminiAgent.getSignal() itself throws
// (its own internal fallback chain normally means it never does).
// C = (1 - variance/maxVariance) * evidenceQuality * mean(scores).
// See claude/strategy-research-findings.md.
function formulaEvaluate(candidate, { bull, bear, riskManager }) {
  if (bear.veto || riskManager.veto) {
    return {
      agent: 'meta_evaluator',
      vetoed: true,
      consensusScore: 0,
      confidenceDelta: 0,
      reason: bear.veto ? `Bear debate veto: ${bear.reason}` : `Risk Manager debate veto: ${riskManager.reason}`,
    };
  }
  const bullScore = bull.signal === 'ENTER' ? bull.confidence : 0;
  const bearScore = 1 - bear.confidence;
  const scores = [bullScore, candidate.rawConfidence, bearScore];
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  const agreement = Math.max(0, 1 - variance / 0.25);
  const evidenceQuality = bull.error ? 0.7 : 0.95;
  const consensusScore = agreement * evidenceQuality * mean;
  const confidenceDelta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, consensusScore - candidate.rawConfidence));
  return {
    agent: 'meta_evaluator',
    vetoed: false,
    consensusScore: Number(consensusScore.toFixed(3)),
    confidenceDelta: Number(confidenceDelta.toFixed(3)),
    reason: `CGX fallback ${(consensusScore * 100).toFixed(0)}% (Gemini unavailable) — bull ${bull.signal}/${bull.confidence.toFixed(2)}, bear conf ${bear.confidence.toFixed(2)} no-veto, proposer ${(candidate.rawConfidence * 100).toFixed(0)}%.`,
  };
}

function buildPeerSignals({ panel, bull, bear, edge, telegramContext }) {
  const peers = [];
  for (const [name, r] of Object.entries(panel || {})) {
    if (r) peers.push({ agent: name, signal: r.signal, confidence: r.confidence, reason: r.reason });
  }
  peers.push({ agent: 'bull_debate', signal: bull.signal === 'ENTER' ? 'BUY' : 'HOLD', confidence: bull.confidence, reason: bull.reason });
  peers.push({ agent: 'bear_debate', signal: bear.veto ? 'SELL' : 'HOLD', confidence: bear.confidence, reason: bear.reason });
  if (edge) {
    peers.push({
      agent: 'strategy_edge',
      signal: edge.edgeSignal || 'HOLD',
      confidence: edge.edgeScore || 0,
      reason: `${edge.contributingCount || 0} backtested strategies: ${edge.summary || 'no edge'}`,
    });
  }
  if (telegramContext) {
    peers.push({ agent: 'telegram_channel', signal: 'HOLD', confidence: 0, reason: `Context only, not a vote: ${telegramContext}` });
  }
  return peers;
}

/**
 * evaluate() — the single Final Judge call site. `symbol`/`marketData` are
 * needed because geminiAgent.getSignal() uses them for its own price/
 * indicator context; `candidate` carries the direction + raw pre-debate
 * confidence; `ctx` carries everything Gemini should weigh.
 */
async function evaluate(symbol, marketData, candidate, ctx) {
  const { bull, bear, riskManager, panel, edge, telegramContext } = ctx || {};
  if (bear.veto || riskManager.veto) {
    return {
      agent: 'meta_evaluator',
      vetoed: true,
      consensusScore: 0,
      confidenceDelta: 0,
      reason: bear.veto ? `Bear debate veto: ${bear.reason}` : `Risk Manager debate veto: ${riskManager.reason}`,
    };
  }

  try {
    const peerSignals = buildPeerSignals({ panel, bull, bear, edge, telegramContext });
    const gemini = await geminiAgent.getSignal(symbol, marketData, peerSignals);
    const geminiSignal = String(gemini.signal || 'HOLD').toUpperCase();
    const judgedConfidence = Math.max(0, Math.min(1, parseFloat(gemini.confidence)));
    if (!Number.isFinite(judgedConfidence)) throw new Error('non-numeric confidence from Gemini');

    if (geminiSignal !== 'HOLD' && geminiSignal !== candidate.direction) {
      return {
        agent: 'meta_evaluator',
        vetoed: true,
        consensusScore: 0,
        confidenceDelta: 0,
        reason: `Gemini Final Judge disagrees with direction (proposed ${candidate.direction}, Gemini says ${geminiSignal}) — ${gemini.reason || ''}`.slice(0, 300),
      };
    }

    const confidenceDelta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, judgedConfidence - candidate.rawConfidence));
    return {
      agent: 'meta_evaluator',
      vetoed: false,
      consensusScore: Number(judgedConfidence.toFixed(3)),
      confidenceDelta: Number(confidenceDelta.toFixed(3)),
      reason: `Gemini Final Judge: ${String(gemini.reason || '').slice(0, 250)}`,
      source: 'gemini',
    };
  } catch (err) {
    logger.warn(`[MetaEvaluator] Gemini Final Judge failed, falling back to CGX formula: ${err.message}`);
    const fallback = formulaEvaluate(candidate, { bull, bear, riskManager });
    return { ...fallback, source: 'cgx_fallback' };
  }
}

module.exports = { evaluate };
