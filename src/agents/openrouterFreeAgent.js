/**
 * openrouterFreeAgent.js
 * ========================
 * Replaces the paid Perplexity agent with a FREE OpenRouter model.
 * Uses rotating keys from .env so no single key hits rate limits.
 *
 * Free models available via OpenRouter (no cost per token):
 *   - google/gemma-2-9b-it:free       ← good for analysis
 *   - mistralai/mistral-7b-instruct:free
 *   - meta-llama/llama-3.2-3b-instruct:free
 *   - deepseek/deepseek-r1:free       ← strong reasoning
 *   - qwen/qwen3-8b:free
 *
 * Place this file at:
 *   C:\Users\AlanJ\projects\AiTradingagent\src\agents\openrouterFreeAgent.js
 */

import axios from "axios";
import { logger } from "../utils/logger.js";

// ── Rotate through your 3 OpenRouter keys ─────────────────────
const KEYS = [
  process.env.OPENROUTER_API_KEY,
  process.env.OPENROUTER_API_KEY_2,
  process.env.OPENROUTER_API_KEY_3,
].filter(Boolean);

let keyIndex = 0;
function getNextKey() {
  const key = KEYS[keyIndex % KEYS.length];
  keyIndex++;
  return key;
}

// ── Free model to use (change this to try different ones) ─────
const FREE_MODEL = "deepseek/deepseek-r1:free";
// Alternatives (just swap the string above):
//   "google/gemma-2-9b-it:free"
//   "mistralai/mistral-7b-instruct:free"
//   "qwen/qwen3-8b:free"

const SYSTEM_PROMPT = `You are a research and fundamentals specialist agent in a
6-agent crypto trading consensus system. Your role is to assess the fundamental
health, recent developments, and macroeconomic context of the requested asset.
Respond ONLY with strict JSON — no prose, no markdown fences:
{
  "signal": "buy" | "sell" | "hold",
  "confidence": <float 0.0-1.0>,
  "reason": "<one-line fundamental justification>",
  "constraints": ["<risk caveat 1>", "<risk caveat 2>"]
}`;

/**
 * @param {object} marketContext - combined data/sentiment payload
 * @returns {Promise<{signal:string, confidence:number, reason:string, constraints:string[]}>}
 */
export async function getOpenRouterFreeSignal(marketContext) {
  const apiKey = getNextKey();
  if (!apiKey) {
    logger.error("openrouterFreeAgent: No OPENROUTER_API_KEY found in .env");
    return { signal: "hold", confidence: 0, reason: "no_api_key", constraints: ["config_error"] };
  }

  try {
    const { data } = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: FREE_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(marketContext) },
        ],
        max_tokens: 500,
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/smokey79/aitradingagent1",
          "X-Title": "AiTradingAgent",
        },
        timeout: 30000,
      }
    );

    let text = data.choices?.[0]?.message?.content ?? "{}";
    // Strip markdown fences if model adds them despite instructions
    text = text.replace(/```json|```/g, "").trim();
    return JSON.parse(text);
  } catch (err) {
    logger.error("openrouterFreeAgent failed", {
      model: FREE_MODEL,
      error: err.response?.data?.error?.message ?? err.message,
    });
    return { signal: "hold", confidence: 0, reason: "agent_error", constraints: ["openrouter_error"] };
  }
}
