"""
ClaudeAgent — uses Anthropic Claude (claude-sonnet-4-6 or claude-opus-4-6).
Returns structured JSON: { signal, confidence, reason, constraints }
"""
import os
import json
import anthropic

class ClaudeAgent:
    MODEL = "claude-sonnet-4-6"

    def __init__(self):
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key or api_key == "your_anthropic_key_here":
            raise EnvironmentError("ANTHROPIC_API_KEY not set in .env")
        self.client = anthropic.Anthropic(api_key=api_key)

    def analyze(self, market_data: dict) -> dict:
        prompt = f"""
Evaluate this crypto market snapshot and respond ONLY with valid JSON. No markdown, no extra text.

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
            message = self.client.messages.create(
                model=self.MODEL,
                max_tokens=512,
                system="You are a disciplined crypto trading analyst. Always respond in strict JSON only.",
                messages=[{"role": "user", "content": prompt}]
            )
            raw = message.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            return json.loads(raw.strip())
        except Exception as e:
            return {"signal": "HOLD", "confidence": 0.0,
                    "reason": f"ClaudeAgent error: {e}",
                    "constraints": {"max_position_pct": 0, "stop_loss_pct": 2, "take_profit_pct": 5}}
