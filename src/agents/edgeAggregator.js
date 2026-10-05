/**
 * src/agents/edgeAggregator.js — NEW 2026-09-27 (Alan's explicit instruction:
 * "strategy s dont vote they add to edge").
 *
 * technical_lab, technical_daily, technical_mtf, evidence_candidates,
 * strategy_learner and traderdev_strategy used to be six independent voters
 * in consensus.js's 12-agent weighted vote, each counting toward
 * agentsAgreeing and the risk gate's majority-agreement check. They no
 * longer vote at all. Instead this module runs all six and folds them into
 * one combined "edge" reading (direction + strength), which is handed to
 * the single AI Final Judge (metaEvaluatorAgent.js) as informational
 * context alongside the live AI panel and the Bull/Bear debate. It can
 * never itself approve or veto a trade — it has no path to riskGate.js
 * except through the Final Judge's own bounded confidence adjustment.
 */
'use strict';

const technicalLabAgent = require('./technicalLabAgent');
const technicalDailyAgent = require('./technicalDailyAgent');
const technicalMtfAgent = require('./technicalMtfAgent');
const evidenceCandidatesAgent = require('./evidenceCandidatesAgent');
const strategyLearningAgent = require('./strategyLearningAgent');
const traderDevAgent = require('./traderDevAgent');

// Same relative weights these six carried in AGENT_WEIGHTS before they were
// retired as voters — kept so the strongest-validated strategies still
// dominate the edge reading, they just no longer count toward agreement.
const EDGE_WEIGHTS = {
  technical_lab: 0.20,
  technical_daily: 0.12,
  technical_mtf: 0.09,
  evidence_candidates: 0.15,
  strategy_learner: 0.15,
  traderdev_strategy: 0.15,
};

const SIGNAL_VALUES = { BUY: 1, SELL: -1, HOLD: 0 };

function normalizeSignal(sig) {
  const upper = String(sig || 'HOLD').toUpperCase();
  if (upper === 'BUY' || upper === 'BULLISH') return 'BUY';
  if (upper === 'SELL' || upper === 'BEARISH') return 'SELL';
  return 'HOLD';
}

function withTimeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)),
  ]);
}

/**
 * Runs all six strategy-type agents in parallel and folds them into one
 * edge reading. Never throws — a failed/timed-out agent is simply left out
 * of the average, same fail-open-but-silent-for-that-one-voice pattern the
 * main vote in consensus.js already uses.
 */
async function getEdge(symbol, marketData) {
  const [labRes, dailyRes, mtfRes, evidenceRes, learnerRes, traderDevRes] = await Promise.allSettled([
    withTimeout(technicalLabAgent.getSignal(symbol, marketData), 8000, 'TechnicalLab'),
    withTimeout(technicalDailyAgent.getSignal(symbol, marketData), 8000, 'TechnicalDaily'),
    withTimeout(technicalMtfAgent.getSignal(symbol, marketData), 8000, 'TechnicalMtf'),
    withTimeout(evidenceCandidatesAgent.getSignal(symbol, marketData), 15000, 'EvidenceCandidates'),
    withTimeout(strategyLearningAgent.getSignal(symbol, marketData), 5000, 'StrategyLearner'),
    withTimeout(traderDevAgent.getSignal(symbol, marketData), 6000, 'TraderDev'),
  ]);

  const results = {
    technical_lab: labRes,
    technical_daily: dailyRes,
    technical_mtf: mtfRes,
    evidence_candidates: evidenceRes,
    strategy_learner: learnerRes,
    traderdev_strategy: traderDevRes,
  };

  const contributions = [];
  for (const [name, res] of Object.entries(results)) {
    if (res.status !== 'fulfilled' || !res.value) continue;
    const signal = normalizeSignal(res.value.signal);
    const confidence = Math.max(0, Math.min(1, parseFloat(res.value.confidence) || 0));
    let weight = EDGE_WEIGHTS[name] || 0.10;
    const vm = Number(res.value.voteMultiplier);
    if (Number.isFinite(vm) && vm > 0) weight = weight * Math.max(0.5, Math.min(1.5, vm));
    contributions.push({ name, signal, confidence, weight, reason: res.value.reason || '' });
  }

  if (contributions.length === 0) {
    return { edgeSignal: 'HOLD', edgeScore: 0, contributingCount: 0, agreeingCount: 0, summary: 'No strategy agents reported this cycle.', breakdown: [] };
  }

  let weightedScore = 0;
  let totalWeight = 0;
  for (const c of contributions) {
    const val = SIGNAL_VALUES[c.signal] || 0;
    const w = c.weight * c.confidence;
    weightedScore += val * w;
    totalWeight += c.signal === 'HOLD' ? w * 0.35 : w;
  }

  const avgScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
  let edgeSignal = 'HOLD';
  if (avgScore >= 0.15) edgeSignal = 'BUY';
  else if (avgScore <= -0.15) edgeSignal = 'SELL';

  const agreeing = contributions.filter(c => c.signal === edgeSignal && c.signal !== 'HOLD');
  const summaryParts = contributions
    .filter(c => c.signal !== 'HOLD')
    .map(c => `${c.name}: ${c.signal} @ ${(c.confidence * 100).toFixed(0)}%`);

  return {
    edgeSignal,
    edgeScore: Number(Math.abs(avgScore).toFixed(3)),
    contributingCount: contributions.length,
    agreeingCount: agreeing.length,
    summary: summaryParts.length ? summaryParts.join('; ') : 'All strategy agents at HOLD — no edge either way.',
    breakdown: contributions,
  };
}

module.exports = { getEdge };
