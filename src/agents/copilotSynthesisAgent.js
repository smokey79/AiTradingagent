import { logger } from "../utils/logger.js";

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
export function synthesize(agentSignals, hermesRuling) {
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
