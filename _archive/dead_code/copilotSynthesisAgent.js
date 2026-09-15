const logger = require("../utils/logger.js");

/**
 * NOTE on Copilot: GitHub Copilot does not expose a public chat-completions
 * REST API the way OpenAI/Anthropic/Gemini do — it's IDE-integrated (VS Code
 * Copilot Chat) or accessible via the `gh copilot` CLI extension for
 * suggest/explain, not arbitrary structured JSON calls. So "Copilot as
 * orchestrator" is implemented here as a deterministic synthesis layer that
 * plays the same role Copilot plays in your workflow: taking every agent's
 * structured signal (including Hermes's ruling) and producing one final
 * call. If you get `gh` CLI access to Copilot in the future, swap the body
 * of `synthesize()` for a real call — the interface stays the same.
 */
function synthesize(agentSignals, hermesRuling) {
  const signals = Object.values(agentSignals);
  const buys = signals.filter((s) => s.signal === "buy").length;
  const sells = signals.filter((s) => s.signal === "sell").length;
  const avgConfidence =
    signals.reduce((sum, s) => sum + (s.confidence || 0), 0) / signals.length;

  let finalSignal = "hold";
  if (buys > sells && hermesRuling.ruling === "buy") finalSignal = "buy";
  if (sells > buys && hermesRuling.ruling === "sell") finalSignal = "sell";

  const result = {
    finalSignal,
    agreementCount: Math.max(buys, sells),
    avgConfidence,
    hermesRuling,
    perAgent: agentSignals,
    timestamp: new Date().toISOString(),
  };

  logger.info("Synthesis complete", { finalSignal, avgConfidence });
  return result;
}

/**
 * Evaluates multi-agent consensus weighting across Claude (40%), Gemini (40%), and Hermes (20%).
 * Enforces a strict 70% confidence minimum gate and automated 40% reinvestment allocation.
 *
 * @param {object} agentResponses - Dictionary containing agent responses e.g. { claude, gemini, hermes }
 * @returns {Promise<{approved: boolean, action?: string, allocation?: string, aggregateScore?: number, reason?: string}>}
 */
async function evaluateConsensus(agentResponses) {
  const { claude, gemini, hermes } = agentResponses || {};

  const claudeConf = claude?.confidence ?? 0;
  const geminiConf = gemini?.confidence ?? 0;
  const hermesConf = hermes?.confidence ?? 0;

  // Impute dynamic weighting logic here based on agent historical accuracy
  const aggregateScore = (claudeConf * 0.4) + (geminiConf * 0.4) + (hermesConf * 0.2);

  if (aggregateScore >= 0.70) { // Enforces the 70% confidence minimum
    return {
      approved: true,
      action: claude?.recommendedAction || claude?.action || claude?.signal || "BUY_BTC",
      allocation: "40%", // Automate the 40% reinvestment split here
      aggregateScore: parseFloat(aggregateScore.toFixed(3)),
    };
  }

  return {
    approved: false,
    reason: "Consensus below 70% threshold",
    aggregateScore: parseFloat(aggregateScore.toFixed(3)),
  };
}

module.exports = {
  synthesize,
  evaluateConsensus,
};

