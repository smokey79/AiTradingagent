/**
 * src/agents/riskManagerDebateAgent.js — NEW 2026-09-27 (Alan's approved
 * Phase 2 plan, item 1). Deterministic hard-veto agent for the debate
 * stage, ported conceptually from
 * F:\aitradingagent2\src\agents\riskManagerAgent.js — mostly deterministic
 * on purpose: reads REAL portfolio state (never an LLM's claim about it),
 * never an LLM's opinion.
 *
 * This does NOT replace riskGate.js's own checks (margin floor, exposure
 * ceiling, win-rate gate, session drawdown, etc.) — those still run,
 * unchanged, at the final gate before sizing. This is an EARLIER,
 * debate-stage veto using the exact same exposure cap riskGate.js already
 * enforces (the 30%-held-back / max-70%-exposure rule from
 * claude/session-2026-09-27-portfolio-manager-sizing-rework.md), so a
 * trade that would breach it is rejected by the debate itself rather than
 * only being caught downstream. Under normal conditions (exposure below
 * cap) this is a no-op — it can only ever make a trade MORE conservative,
 * never less.
 */
'use strict';
const { getPortfolioState } = require('../risk/riskGate');

function run(symbol) {
  const state = getPortfolioState();
  const heatCapPct = state.maxExposurePct;
  const currentHeatPct = state.exposurePct;
  const wouldExceed = currentHeatPct >= heatCapPct;

  return {
    agent: 'risk_manager_debate',
    veto: wouldExceed,
    confidence: 1.0,
    reason: wouldExceed
      ? `Portfolio exposure (${currentHeatPct}%) already at/above the ${heatCapPct}% cap — Risk Manager debate vetoes new entries until exposure clears.`
      : `Within limits: ${currentHeatPct}% exposure vs ${heatCapPct}% cap.`,
    currentHeatPct,
    heatCapPct,
  };
}

module.exports = { run };
