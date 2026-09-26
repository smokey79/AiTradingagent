# MERGE GUIDE — Python Engine → F:\aitradingagent
## Alan J | barcay0611@gmail.com | GitHub: smokey79

---

## WHAT YOU'RE MERGING

```
BEFORE (two separate engines):
  F:\aitradingagent\     ← Node.js (13 agents, PM2, dashboard port 3002)
  C:\Users\barcl\projects\AiTradingAgent\  ← Python (arb scanner, LLM)

AFTER (one unified system):
  F:\aitradingagent\     ← Everything runs here
    ├── Node.js engine   ← unchanged, port 3002
    ├── Python engine    ← moved here, talks to Node.js via bridge
    └── PM2 manages all  ← 4 processes: node, arb-scanner, debate, fastapi
```

---

## STEP 1 — Copy Python files into F:\aitradingagent (15 mins)

Open PowerShell as Administrator:

```powershell
# Go to your project
cd F:\aitradingagent

# Create Python folder structure
mkdir bridge, scripts, analytics, execution, agents -ErrorAction SilentlyContinue
mkdir src\data, src\flashloan, src\utils, config -ErrorAction SilentlyContinue
mkdir logs -ErrorAction SilentlyContinue

# Copy existing Python files from C: drive
$src = "C:\Users\barcl\projects\AiTradingAgent"
Copy-Item "$src\config\chains.py"                   "F:\aitradingagent\config\"
Copy-Item "$src\src\data\dexscreener_feed.py"       "F:\aitradingagent\src\data\"
Copy-Item "$src\src\flashloan\cross_chain_arbitrage.py" "F:\aitradingagent\src\flashloan\"
Copy-Item "$src\src\utils\gas_optimizer.py"         "F:\aitradingagent\src\utils\"
```

---

## STEP 2 — Add new files from this session (10 mins)

Download each file from the chat and save to these exact paths:

| File downloaded          | Save to                                           |
|--------------------------|---------------------------------------------------|
| arbitrage_scanner_merged | F:\aitradingagent\src\flashloan\arbitrage_scanner.py |
| python_to_node.py        | F:\aitradingagent\bridge\python_to_node.py        |
| pythonBridge.js          | F:\aitradingagent\src\bridge\pythonBridge.js      |
| ecosystem.config.js      | F:\aitradingagent\ecosystem.config.js             |
| debate_agent.py          | F:\aitradingagent\agents\debate_agent.py          |
| learning_agent.py        | F:\aitradingagent\agents\learning_agent.py        |
| nexo_sweep.py            | F:\aitradingagent\core\nexo_sweep.py              |
| walk_forward.py          | F:\aitradingagent\analytics\walk_forward.py       |
| order_router.py          | F:\aitradingagent\execution\order_router.py       |
| run_paper_test.py        | F:\aitradingagent\scripts\run_paper_test.py       |
| config.py                | F:\aitradingagent\core\config.py                  |
| data_schema.py           | F:\aitradingagent\core\data_schema.py             |
| llm_router.py            | F:\aitradingagent\core\llm_router.py              |
| strategy_agent.py        | F:\aitradingagent\agents\strategy_agent.py        |
| market_data.py           | F:\aitradingagent\data\market_data.py             |
| patterns.py              | F:\aitradingagent\analytics\patterns.py           |
| tradingview_webhook.py   | F:\aitradingagent\api\tradingview_webhook.py      |
| main.py                  | F:\aitradingagent\main.py                         |

---

## STEP 3 — Wire pythonBridge into Node.js app (5 mins)

Open F:\aitradingagent\src\index.js (or app.js — whatever your Node entry is).

Find where you mount Express routes. Add these two lines:

```javascript
const pythonBridge = require('./bridge/pythonBridge');
app.use('/api', pythonBridge);
```

That's it — the bridge endpoints are now live at:
  http://localhost:3002/api/python-signal
  http://localhost:3002/api/python-arb
  http://localhost:3002/api/bridge/status

---

## STEP 4 — Create .env in F:\aitradingagent (10 mins)

Copy .env.template → .env  and fill in:

```
APP_ANTHROPIC_API_KEY=sk-ant-...
APP_BYBIT_API_KEY=...
APP_BYBIT_API_SECRET=...
NEXO_BTC_ADDRESS=bc1q...
PAPER_TRADE_MODE=true
NODE_ROOT=F:\aitradingagent
NODE_API_BASE=http://localhost:3002
```

---

## STEP 5 — Install Python dependencies (5 mins)

```powershell
cd F:\aitradingagent
pip install fastapi uvicorn pydantic pydantic-settings anthropic
pip install requests python-dotenv web3
```

---

## STEP 6 — Test the bridge (5 mins)

```powershell
# Terminal 1 — start Node.js (if not already running)
cd F:\aitradingagent
pm2 start ecosystem.config.js --only node-orchestrator

# Terminal 2 — test Python bridge
cd F:\aitradingagent
python src\flashloan\arbitrage_scanner.py

# Check bridge received the signal
curl http://localhost:3002/api/bridge/status
curl http://localhost:3002/api/python-signal/latest
```

---

## STEP 7 — Start everything with PM2 (3 mins)

```powershell
cd F:\aitradingagent
pm2 start ecosystem.config.js
pm2 status
pm2 logs
```

You should see 4 processes running:
  ✅ node-orchestrator   (port 3002)
  ✅ arb-scanner         (scans every 60s)
  ✅ python-debate       (LLM decisions)
  ✅ fastapi             (port 8000)

---

## STEP 8 — Push merged code to GitHub (5 mins)

```powershell
cd F:\aitradingagent
git add .
git commit -m "Merge Python engine into Node.js project — bridge + PM2"
git push origin main
```

---

## WHAT HAPPENS AFTER MERGE

Every 60 seconds:
1. arb-scanner fetches live DEX prices from DexScreener
2. Finds cross-chain spread opportunities
3. Passes through gas gate (min $1.50 net profit)
4. Writes results to vault_summary.json  ← Node.js dashboard reads this
5. POSTs best signal to Node.js orchestrator via /api/python-signal
6. Node.js 13-agent system picks it up and processes it

On TradingView alert:
1. FastAPI receives webhook (port 8000) with HMAC auth
2. Signal published to Node.js via bridge
3. Debate agents (Bull/Bear/Neutral) vote
4. Learning agent weighs in with historical context
5. Decision written to latest_decision.json
6. Order router executes (PAPER MODE until 500-trade test passes)
7. Profit logged → Nexo BTC sweep when threshold hit

---

## IF YOU HIT ERRORS

"Module not found: bridge.python_to_node"
→ Check PYTHONPATH=F:\aitradingagent in your .env or PM2 env

"Cannot connect to Node.js API"
→ Bridge falls back to file-only mode automatically. Check Node is running on 3002.

"Port 8000 already in use"
→ pm2 stop fastapi  then  pm2 start ecosystem.config.js --only fastapi

"Python not found"
→ In ecosystem.config.js change 'python' to 'python3' or full path e.g. 'C:\Python311\python.exe'
