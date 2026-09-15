"""
OpenRouterAgent — uses free-tier models via OpenRouter as the 6th agent.
Free models: mistralai/mistral-7b-instruct, meta-llama/llama-3-8b-instruct etc.
No cost. Returns structured JSON: { signal, confidence, reason, constraints }
"""
import os
import json
import requests

class OpenRouterAgent:
    API_URL = "https://openrouter.ai/api/v1/chat/completions"
    # Free models that work without credits — auto-fallback list
    FREE_MODELS = [
        "mistralai/mistral-7b-instruct:free",
        "meta-llama/llama-3-8b-instruct:free",
        "google/gemma-2-9b-it:free",
        "microsoft/phi-3-mini-128k-instruct:free"
    ]

    def __init__(self):
        self.api_key = os.getenv("OPENROUTER_API_KEY")
        if not self.api_key:
            raise EnvironmentError("OPENROUTER_API_KEY not set in .env")

    def analyze(self, market_data: dict) -> dict:
        prompt = f"""You are a disciplined crypto trading risk analyst.
Evaluate this market snapshot and respond ONLY with valid JSON — no markdown, no extra text.

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
}}"""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://github.com/smokey79/aitradingagent1",
            "X-Title": "AiTradingAgent"
        }

        for model in self.FREE_MODELS:
            try:
                response = requests.post(self.API_URL, headers=headers, json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "Respond in strict JSON only."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.2
                }, timeout=20)
                data = response.json()
                raw = data["choices"][0]["message"]["content"].strip()
                if raw.startswith("```"):
                    raw = raw.split("```")[1]
                    if raw.startswith("json"):
                        raw = raw[4:]
                return json.loads(raw.strip())
            except Exception:
                continue  # try next free model

        return {"signal": "HOLD", "confidence": 0.0,
                "reason": "OpenRouterAgent: all free models failed",
                "constraints": {"max_position_pct": 0, "stop_loss_pct": 2, "take_profit_pct": 5}}
