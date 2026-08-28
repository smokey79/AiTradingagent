# AiTradingAgents — Action Plan
## Alan J | barcay0611@gmail.com | GitHub: smokey79

---

## YOUR IMMEDIATE STEPS (do these first)

### STEP 1 — Set up your project folder (30 mins)
Open VS Code. Press Ctrl+` to open the terminal.
Create this folder structure:

```
AiTradingAgents/
├── agents/
│   ├── strategy_agent.py       ← from our chat
│   ├── sentiment_agent.py      ← from our chat
│   └── learning_agent.py       ← NEW (download above)
├── core/
│   ├── config.py               ← from our chat
│   ├── data_schema.py          ← from our chat
│   ├── llm_router.py           ← from our chat
│   └── nexo_sweep.py           ← NEW (download above)
├── analytics/
│   └── patterns.py             ← from our chat
├── data/
│   └── market_data.py          ← from our chat
├── api/
│   └── tradingview_webhook.py  ← from our chat
├── scripts/
│   └── run_paper_test.py       ← NEW (download above)
├── main.py                     ← from our chat
├── .env                        ← copy from .env.template, fill in your keys
├── .gitignore
└── requirements.txt
```

### STEP 2 — Create .gitignore (2 mins)
In VS Code, create a file called `.gitignore` and paste:
```
.env
data/
__pycache__/
*.db
*.pyc
.DS_Store
```

### STEP 3 — Install dependencies (5 mins)
In VS Code terminal:
```bash
pip install fastapi uvicorn pydantic pydantic-settings anthropic requests
pip install python-dotenv youtube-transcript-api newsapi-python
pip install web3 pytest
```

### STEP 4 — Fill in your .env file (20 mins)
Copy `.env.template` to `.env`
Fill in at minimum:
- APP_ANTHROPIC_API_KEY (you have this)
- APP_BYBIT_API_KEY + APP_BYBIT_API_SECRET
- NEXO_BTC_ADDRESS (your BTC deposit address from Nexo)
- YOUTUBE_API_KEY (from Google Cloud Console, free)
- GITHUB_TOKEN (from github.com → Settings → Developer Settings)

Leave everything else blank for now.

### STEP 5 — Run the 500-trade paper test (5 mins)
```bash
python scripts/run_paper_test.py
```
All 3 checks must pass (✅) before you touch live trading.
DO NOT skip this step.

### STEP 6 — Push to GitHub (5 mins)
```bash
git init
git remote add origin https://github.com/smokey79/AiTradingAgents.git
git add .
git commit -m "Initial commit — paper trade pipeline"
git push -u origin main
```

### STEP 7 — Deploy to Vercel (10 mins)
```bash
npm install -g vercel
vercel login
vercel --prod
```
Set your .env variables in Vercel dashboard → Settings → Environment Variables.

---

## WHAT'S BUILT (working code available above)
- ✅ config.py — Bybit, Crypto.com, env prefix, secret validation
- ✅ data_schema.py — Candle with full OHLC validation
- ✅ llm_router.py — Anthropic + Grok + fallback chain
- ✅ strategy_agent.py — LLM decision with JSON parsing + fallback
- ✅ market_data.py — CoinGecko + CoinMarketCap clients
- ✅ patterns.py — Double top/bottom detection + backtest
- ✅ tradingview_webhook.py — HMAC auth, Pydantic validated
- ✅ main.py — FastAPI + lifespan wiring + /backtest + /health
- ✅ learning_agent.py — SQLite memory, win-rate tracking, weight adaptation
- ✅ nexo_sweep.py — Profit ledger + Nexo BTC sweep stub
- ✅ run_paper_test.py — 500-trade validation pipeline

---

## WHAT'S NEXT (future sessions)
1. **YouTube signal ingestion** — youtube-transcript-api + channel filter
2. **Sentiment agent** — NewsAPI + YouTube + Binance funding rates → LLM score
3. **Multi-LLM majority vote** — 3 providers vote, majority wins
4. **Bybit live execution** — pybit SDK, order placement, position management
5. **Nexo API wiring** — connect real withdrawal endpoint
6. **Discord signal intake** — structured signal parser + per-channel scoring
7. **Portfolio simulator** — equity curve, Sharpe ratio, max drawdown live
8. **Glassnode on-chain data** — funding rates, exchange flows
9. **Full Vercel deployment** — /api/v1 routes, environment variables set

---

## KEY RULES — DO NOT BREAK THESE
1. PAPER_TRADE_MODE=true until 500-trade test passes with all ✅
2. Never commit .env to GitHub
3. Never set APP_ENV=production until you've run 2 weeks paper trading
4. Max daily loss cap ($50 default) must stay in config
5. All profits go to Nexo BTC address only — no manual withdrawals

---

## NOTE ON "OPENCLAW"
If you mean OpenClaude (this conversation) — already integrated via AnthropicClient.
If you mean a specific tool/service, send me a link and I'll wire it in next session.
