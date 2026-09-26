# AiTradingAgent — Agent Skills + MCP Setup Guide

## What Was Built

```
AiTradingagent/
├── agents/skills/                        ← Agent skill definitions (system prompts)
│   ├── SKILL_COPILOT_ORCHESTRATOR.md     ← Meta-orchestrator (Claude API)
│   ├── SKILL_CLAUDE_ANALYST.md           ← Technical analysis agent
│   ├── SKILL_GPT4O_SENTIMENT.md          ← Sentiment + macro agent
│   ├── SKILL_GROK_REALTIME.md            ← Real-time news + social agent
│   ├── SKILL_GEMINI_CROSSVALIDATOR.md    ← Cross-validation + risk scorer
│   └── SKILL_PERPLEXITY_RESEARCHER.md    ← Deep research + fundamentals
│
├── mcp-servers/
│   ├── trading-data-mcp/
│   │   ├── package.json
│   │   └── index.js                      ← 7 tools: OHLCV, indicators, F&G, funding rates, orderbook, CMC, CoinGecko
│   └── risk-gate-mcp/
│       ├── package.json
│       └── index.js                      ← 4 tools: evaluate_trade_risk, check_portfolio, log_trade, get_win_rate
│
├── orchestrator/
│   └── consensus_engine.py               ← Main Python orchestrator (runs all 6 agents)
│
└── config/
    └── claude_desktop_config.json        ← Copy to Claude Desktop AppData folder
```

---

## Step 1: Copy Files to Your Project

Open PowerShell and run:
```powershell
# Copy everything into your existing project
xcopy /E /I /Y "path\to\downloaded\aitradingagent" "C:\Users\barcl\projects\AiTradingagent"
```

---

## Step 2: Install MCP Server Dependencies

Open PowerShell in VS Code terminal (Ctrl + ` to open terminal):

```powershell
# Trading data MCP
cd C:\Users\barcl\projects\AiTradingagent\mcp-servers\trading-data-mcp
npm install

# Risk gate MCP
cd C:\Users\barcl\projects\AiTradingagent\mcp-servers\risk-gate-mcp
npm install
```

---

## Step 3: Add Keys to Your .env File

Open: `C:\Users\barcl\projects\AiTradingagent\.env`

Add these lines (you already have some of these):
```
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
OPENROUTER_API_KEY=your_key_here        # for Grok via OpenRouter
GEMINI_API_KEY=your_key_here
PERPLEXITY_API_KEY=your_key_here
CMC_API_KEY=your_key_here               # CoinMarketCap
COINGECKO_API_KEY=                      # Optional, leave blank for free tier
```

---

## Step 4: Install Python Dependencies

In VS Code terminal:
```powershell
pip install anthropic openai httpx python-dotenv requests --break-system-packages
```

---

## Step 5: Set Up Claude Desktop MCP Config

```powershell
# Copy the MCP config to Claude Desktop's config folder
copy "C:\Users\barcl\projects\AiTradingagent\config\claude_desktop_config.json" `
     "C:\Users\barcl\AppData\Roaming\Claude\claude_desktop_config.json"
```

Then **restart Claude Desktop**. You should see the MCP tools appear.

---

## Step 6: Test the Consensus Engine

In VS Code terminal:
```powershell
cd C:\Users\barcl\projects\AiTradingagent
python orchestrator/consensus_engine.py --symbol BTC/USDT --paper
```

---

## How It Works (Simple Explanation)

```
market data
    ↓
[Claude]  [GPT-4o]  [Grok]  [Perplexity]   ← All run at the SAME TIME (parallel)
    ↓           ↓       ↓         ↓
         [Gemini] ← sees all 4 outputs, cross-validates
              ↓
         [Copilot] ← sees all 5 outputs, makes FINAL decision
              ↓
         APPROVED? → Freqtrade executes
         VETOED?   → No trade, logged for review
```

---

## MCP Tools Available in Claude Desktop

Once configured, Claude Desktop has access to:

**trading-data tools:**
- `get_ohlcv` — live candles
- `get_indicators` — RSI, EMA, MACD
- `get_fear_greed` — Fear & Greed Index
- `get_funding_rates` — futures funding
- `get_orderbook` — bid/ask imbalance
- `get_cmc_data` — CoinMarketCap data
- `get_coingecko_data` — fundamentals

**risk-gate tools:**
- `evaluate_trade_risk` — score any trade 0-10
- `check_portfolio_state` — exposure check
- `log_trade_result` — record outcome
- `get_win_rate` — rolling 80% gate check
