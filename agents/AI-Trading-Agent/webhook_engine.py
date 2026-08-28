import os
import json
import ccxt
import uvicorn
from openai import OpenAI
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
from dotenv import load_dotenv
import google.generativeai as genai
from modules.cross_chain_arbitrage import TradeCostBot

load_dotenv()

app = FastAPI(title="Multi-LLM Trading & Webhook Gateway")
cost_bot = TradeCostBot()

WEBHOOK_PASSPHRASE = os.getenv("WEBHOOK_PASSPHRASE", "SECRET_TRADINGVIEW_TOKEN")

# Agent 1: Gemini
if os.getenv("GEMINI_API_KEY"):
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
gemini_model = genai.GenerativeModel("gemini-2.5-pro")

# Agent 2: Hermes (Ollama / OpenRouter)
hermes_client = OpenAI(
    base_url=os.getenv("HERMES_BASE_URL", "http://localhost:11434/v1"),
    api_key=os.getenv("HERMES_API_KEY", "ollama")
)
HERMES_MODEL = os.getenv("HERMES_MODEL", "hermes3")

# Exchanges
bitget = ccxt.bitget({
    'apiKey': os.getenv("BITGET_API_KEY", ""),
    'secret': os.getenv("BITGET_SECRET_KEY", ""),
    'password': os.getenv("BITGET_PASSPHRASE", ""),
    'enableRateLimit': True,
})

cryptocom = ccxt.cryptocom({
    'apiKey': os.getenv("CRYPTOCOM_API_KEY", ""),
    'secret': os.getenv("CRYPTOCOM_SECRET_KEY", ""),
    'enableRateLimit': True,
})

class TradingViewAlert(BaseModel):
    passphrase: str
    ticker: str
    action: str
    price: float
    timeframe: str = "15m"
    indicator: str = "Strategy"

def query_gemini_agent(payload_str: str) -> dict:
    prompt = f"You are Agent 1 (Risk Evaluator). Analyze this alert: {payload_str}. Return ONLY JSON: {{\"confirm\": bool, \"confidence\": float, \"reason\": str}}"
    try:
        res = gemini_model.generate_content(prompt)
        return json.loads(res.text.replace("```json", "").replace("```", "").strip())
    except Exception as e:
        return {"confirm": False, "confidence": 0.0, "reason": f"Gemini: {e}"}

def query_hermes_agent(payload_str: str) -> dict:
    try:
        res = hermes_client.chat.completions.create(
            model=HERMES_MODEL,
            messages=[
                {"role": "system", "content": "You are Agent 2 (Execution Strategist). Output ONLY valid JSON: {\"confirm\": bool, \"confidence\": float, \"target_exchange\": \"bitget\"|\"cryptocom\", \"reason\": str}"},
                {"role": "user", "content": f"Alert: {payload_str}"}
            ],
            temperature=0.2
        )
        return json.loads(res.choices[0].message.content.replace("```json", "").replace("```", "").strip())
    except Exception as e:
        return {"confirm": False, "confidence": 0.0, "target_exchange": "bitget", "reason": f"Hermes: {e}"}

def process_trade_alert(alert: TradingViewAlert):
    payload = json.dumps(alert.model_dump())
    print(f"\n[Webhook Received] {alert.ticker} | Action: {alert.action} | Price: {alert.price}")

    gemini_vote = query_gemini_agent(payload)
    hermes_vote = query_hermes_agent(payload)

    print(f" > [Gemini]  Confirm: {gemini_vote.get('confirm')} (Conf: {gemini_vote.get('confidence')})")
    print(f" > [Hermes]  Confirm: {hermes_vote.get('confirm')} (Conf: {hermes_vote.get('confidence')})")

    avg_conf = (gemini_vote.get("confidence", 0) + hermes_vote.get("confidence", 0)) / 2.0
    approved = gemini_vote.get("confirm") and hermes_vote.get("confirm") and avg_conf >= 0.75

    if approved:
        target = hermes_vote.get("target_exchange", "bitget")
        print(f"\n>> CONSENSUS APPROVED ({avg_conf:.2f}) -> EXECUTING {alert.action} on {target.upper()} <<")
        # Live/Paper order logic triggers here
    else:
        print(f"\n>> TRADE REJECTED (Consensus: {approved}, Avg Conf: {avg_conf:.2f}) <<")

@app.post("/webhook")
async def webhook(alert: TradingViewAlert, background_tasks: BackgroundTasks):
    if alert.passphrase != WEBHOOK_PASSPHRASE:
        raise HTTPException(status_code=401, detail="Unauthorized")
    background_tasks.add_task(process_trade_alert, alert)
    return {"status": "processing", "ticker": alert.ticker}

@app.get("/health")
def health():
    return {"status": "online", "service": "Trading Agent Gateway"}

if __name__ == "__main__":
    uvicorn.run("webhook_engine:app", host="0.0.0.0", port=8080, reload=False)
