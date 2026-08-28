import OpenAI from "openai";
import { logger } from "../utils/logger.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are the GPT-4o specialist agent in a 6-agent crypto trading
consensus system. Respond ONLY with strict JSON: {"signal": "buy"|"sell"|"hold",
"confidence": 0.0-1.0, "reason": "short justification", "constraints": ["caveats"]}.`;

export async function getGpt4oSignal(marketContext) {
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(marketContext) },
      ],
    });
    return JSON.parse(completion.choices[0].message.content);
  } catch (err) {
    logger.error("gpt4oAgent failed", { error: err.message });
    return { signal: "hold", confidence: 0, reason: "agent_error", constraints: ["error"] };
  }
}
