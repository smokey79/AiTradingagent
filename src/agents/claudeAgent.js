import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../utils/logger.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are the Claude specialist agent in a 6-agent crypto trading
consensus system. Given market data, on-chain metrics, and sentiment context, respond
ONLY with strict JSON: {"signal": "buy"|"sell"|"hold", "confidence": 0.0-1.0,
"reason": "short justification", "constraints": ["any risk caveats"]}. No prose,
no markdown fences — JSON only.`;

/**
 * @param {object} marketContext - combined data/sentiment payload from the orchestrator
 * @returns {Promise<{signal:string, confidence:number, reason:string, constraints:string[]}>}
 */
export async function getClaudeSignal(marketContext) {
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(marketContext) }],
    });
    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    return JSON.parse(text);
  } catch (err) {
    logger.error("claudeAgent failed", { error: err.message });
    return { signal: "hold", confidence: 0, reason: "agent_error", constraints: ["error"] };
  }
}
