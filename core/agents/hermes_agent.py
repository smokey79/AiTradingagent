"""
HermesAgent — uses local Hermes3 via Ollama (no API cost, runs on your machine).
Returns structured JSON: { signal, confidence, reason, constraints }
Requires: ollama pull hermes3  (run once in terminal)
"""
import os
import json
import requests

class HermesAgent:
    OLLAMA_URL = "http://localhost:11434/api/generate"
    MODEL = "hermes3"

    def __init__(self):
        # No API key needed — local model
        self.url = os.getenv("OLLAMA_URL", self.OLLAMA_URL)

    def _is_available(self) -> bool:
        try:
            r = requests.get("http://localhost:11434/api/tags", timeout=3)
            models = [m["name"] for m in r.json().get("models", [])]
            return any("hermes" in m for m in models)
        except Exception:
            return False

    def analyze(self, market_data: dict) -> dict:
        if not self._is_available():
            return {"signal": "HOLD", "confidence": 0.0,
                    "reason": "HermesAgent unavailable — run: ollama pull hermes3",
                    "constraints": {"max_position_pct": 0, "stop_loss_pct": 2, "take_profit_pct": 5}}

        prompt = f"""<|im_start|>system
You are a disciplined crypto trading risk analyst. Respond ONLY with valid JSON. No markdown, no explanation outside JSON.
<|im_end|>
<|im_start|>user
Evaluate this crypto market snapshot:
{json.dumps(market_data, indent=2)}

Respond in this exact JSON format:
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
<|im_end|>
<|im_start|>assistant
"""
        try:
            response = requests.post(self.url, json={
                "model": self.MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.2, "num_predict": 256}
            }, timeout=30)
            raw = response.json().get("response", "").strip()
            # Extract JSON block if wrapped
            if "{" in raw:
                raw = raw[raw.index("{"):raw.rindex("}")+1]
            return json.loads(raw)
        except Exception as e:
            return {"signal": "HOLD", "confidence": 0.0,
                    "reason": f"HermesAgent error: {e}",
                    "constraints": {"max_position_pct": 0, "stop_loss_pct": 2, "take_profit_pct": 5}}
