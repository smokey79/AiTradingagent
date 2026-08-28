"""
GeminiAgent — wraps google.genai (new SDK, not deprecated google.generativeai).
Returns structured JSON: { signal, confidence, reason, constraints }
"""
import os
import json
from google import genai
from google.genai import types

class GeminiAgent:
    MODEL = "gemini-2.5-pro"

    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise EnvironmentError("GEMINI_API_KEY not set in .env")
        # Explicitly use developer API, not Vertex
        self.client = genai.Client(api_key=api_key, vertexai=False)

    def analyze(self, market_data: dict) -> dict:
        prompt = f"""
You are a disciplined crypto trading risk analyst. Evaluate the market snapshot below.
Respond ONLY with valid JSON — no markdown, no explanation outside the JSON.

Market Data:
{json.dumps(market_data, indent=2)}

Required JSON format:
{{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": <float 0.0-1.0>,
  "reason": "<one sentence>",
  "constraints": {{
    "max_position_pct": <float>,
    "stop_loss_pct": <float>,
    "take_profit_pct": <float>
  }}
}}
"""
        try:
            response = self.client.models.generate_content(
                model=self.MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(temperature=0.2)
            )
            raw = response.text.strip()
            # Strip markdown fences if present
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            return json.loads(raw.strip())
        except Exception as e:
            return {"signal": "HOLD", "confidence": 0.0,
                    "reason": f"GeminiAgent error: {e}",
                    "constraints": {"max_position_pct": 0, "stop_loss_pct": 2, "take_profit_pct": 5}}
