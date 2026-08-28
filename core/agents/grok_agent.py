"""
GrokAgent — uses xAI Grok via OpenAI-compatible API.
Returns structured JSON: { signal, confidence, reason, constraints }
"""
import os
import json
from openai import OpenAI

class GrokAgent:
    MODEL = "grok-beta"

    def __init__(self):
        api_key = os.getenv("GROK_API_KEY") or os.getenv("XAI_API_KEY")
        if not api_key:
            raise EnvironmentError("GROK_API_KEY not set in .env")
        self.client = OpenAI(
            api_key=api_key,
            base_url="https://api.x.ai/v1"
        )

    def analyze(self, market_data: dict) -> dict:
        prompt = f"""
You are a disciplined crypto trading risk analyst. Evaluate the market snapshot below.
Respond ONLY with valid JSON — no markdown, no extra text.

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
            response = self.client.chat.completions.create(
                model=self.MODEL,
                messages=[
                    {"role": "system", "content": "You are a disciplined crypto trading analyst. Respond in strict JSON only."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2
            )
            raw = response.choices[0].message.content.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            return json.loads(raw.strip())
        except Exception as e:
            return {"signal": "HOLD", "confidence": 0.0,
                    "reason": f"GrokAgent error: {e}",
                    "constraints": {"max_position_pct": 0, "stop_loss_pct": 2, "take_profit_pct": 5}}
