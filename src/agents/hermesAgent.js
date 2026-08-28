import axios from "axios";
import { logger } from "../utils/logger.js";

/**
 * Hermes 3 (NousResearch) running locally via Ollama acts as a final
 * consensus validator: it receives every specialist agent's structured
 * JSON output and issues a ruling. Keeping this local avoids sending
 * the full multi-agent disagreement context to a paid API.
 */
export async function getHermesRuling(agentSignals) {
  const host = process.env.OLLAMA_HOST || "http://localhost:11434";
  const model = process.env.HERMES_MODEL_NAME || "hermes3";

  const prompt = `You are a consensus validator reviewing signals from 5 trading
agents (Claude, GPT-4o, Grok, Gemini, Perplexity). Signals: ${JSON.stringify(
    agentSignals
  )}. Respond ONLY with JSON: {"ruling": "buy"|"sell"|"hold", "agreementCount": n,
"avgConfidence": 0.0-1.0, "notes": "short summary"}.`;

  try {
    const { data } = await axios.post(`${host}/api/generate`, {
      model,
      prompt,
      stream: false,
      format: "json",
    });
    return JSON.parse(data.response);
  } catch (err) {
    logger.error("hermesAgent (Ollama) failed — is Ollama running locally?", {
      error: err.message,
    });
    return { ruling: "hold", agreementCount: 0, avgConfidence: 0, notes: "hermes_error" };
  }
}
