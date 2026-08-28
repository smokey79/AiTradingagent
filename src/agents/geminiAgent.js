import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../utils/logger.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `You are the Gemini specialist agent in a 6-agent crypto trading
consensus system. Respond ONLY with strict JSON: {"signal": "buy"|"sell"|"hold",
"confidence": 0.0-1.0, "reason": "short justification", "constraints": ["caveats"]}.
No markdown fences.`;

export async function getGeminiSignal(marketContext) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro",
      systemInstruction: SYSTEM_PROMPT,
    });
    const result = await model.generateContent(JSON.stringify(marketContext));
    const text = result.response.text().replace(/```json|```/g, "").trim();
    return JSON.parse(text);
  } catch (err) {
    logger.error("geminiAgent failed", { error: err.message });
    return { signal: "hold", confidence: 0, reason: "agent_error", constraints: ["error"] };
  }
}
