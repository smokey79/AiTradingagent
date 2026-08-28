import OpenAI from "openai";
import { logger } from "../utils/logger.js";

// xAI's API is OpenAI-SDK compatible via a custom baseURL.
const client = new OpenAI({
  apiKey: process.env.XAI_API_KEY || process.env.GROK_API_KEY,
  baseURL: "https://api.x.ai/v1",
});

const SYSTEM_PROMPT = `You are the Grok specialist agent in a 6-agent crypto trading
consensus system, weighted toward real-time X/social signal. Respond ONLY with strict
JSON: {"signal": "buy"|"sell"|"hold", "confidence": 0.0-1.0, "reason": "short
justification", "constraints": ["caveats"]}.`;

export async function getGrokSignal(marketContext) {
  try {
    const completion = await client.chat.completions.create({
      model: "grok-2-latest",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(marketContext) },
      ],
    });
    const text = completion.choices[0].message.content;
    return JSON.parse(text);
  } catch (err) {
    logger.error("grokAgent failed", { error: err.message });
    return { signal: "hold", confidence: 0, reason: "agent_error", constraints: ["error"] };
  }
}
