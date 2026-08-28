import axios from "axios";
import { logger } from "../utils/logger.js";

const SYSTEM_PROMPT = `You are the Perplexity specialist agent in a 6-agent crypto
trading consensus system, weighted toward current news/research grounding. Respond
ONLY with strict JSON: {"signal": "buy"|"sell"|"hold", "confidence": 0.0-1.0,
"reason": "short justification", "constraints": ["caveats"]}.`;

export async function getPerplexitySignal(marketContext) {
  try {
    const { data } = await axios.post(
      "https://api.perplexity.ai/chat/completions",
      {
        model: "sonar-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(marketContext) },
        ],
      },
      { headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}` } }
    );
    const text = data.choices[0].message.content.replace(/```json|```/g, "").trim();
    return JSON.parse(text);
  } catch (err) {
    logger.error("perplexityAgent failed", { error: err.message });
    return { signal: "hold", confidence: 0, reason: "agent_error", constraints: ["error"] };
  }
}
