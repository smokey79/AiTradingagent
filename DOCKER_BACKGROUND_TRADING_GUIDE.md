# AiTradingAgent - Background Trading System Setup

## ✅ System Configuration Complete

Your AiTradingAgent is now configured for background operation with two trading modes:

### 🚀 Quick Start

1. **Double-click desktop shortcut:** `AiTradingAgent.lnk`
   - Launches launcher in background (safe to close window)
   - Services continue running indefinitely
   - Auto-opens dashboard at http://localhost:3002

2. **Access Control Panel:** http://localhost:3002/trading-control.html
   - Visual TRADE/STOP toggle buttons
   - Real-time mode status display
   - Multi-LLM consensus indicator

---

## 🎮 Trading Modes

### **MANUAL Mode** (Default - Default on startup)
```
Status: MANUAL
Behavior:
  ✓ All 5 LLMs active (Claude, GPT-4o, Gemini, OpenRouter, Azure)
  ✓ Consensus engine analyzes markets continuously
  ✓ Risk gate evaluates all proposals
  ✗ NO automatic execution
  
You will:
  • See multi-LLM recommendations on dashboard
  • Review risk assessment and consensus score (need 4/5 + 70% confidence)
  • Click to manually approve & execute each trade
  • Override AI recommendations if desired
```

### **AUTO Mode** (Autonomous Trading)
```
Status: AUTO
Behavior:
  ✓ All 5 LLMs active (same analysis)
  ✓ Consensus engine automatically executes trades
  ✓ Risk gate enforces position limits
  ✓ Trades execute when consensus + confidence > 70%
  
System will:
  • Auto-execute trades meeting consensus threshold
  • Enforce risk gates (max leverage, position size, daily loss)
  • Log all executions to dashboard
  • Fail-safe to MANUAL mode if risk gates reject
```

---

## 📱 Control Panel

**Access:** http://localhost:3002/trading-control.html

### Buttons:
- **🟢 TRADE** - Switch to AUTO mode (autonomous execution)
- **🛑 STOP** - Switch back to MANUAL mode (approval required)

Both modes keep all LLMs active for analysis.

---

## 🔌 API Endpoints (Port 3005)

### Mode Control:
```
POST http://localhost:3005/mode/trade
  → Switches to AUTO mode

POST http://localhost:3005/mode/stop
  → Switches to MANUAL mode

POST http://localhost:3005/mode/toggle
  → Toggles between modes

GET http://localhost:3005/state
  → Returns current mode, status, trade count

GET http://localhost:3005/consensus/status
  → Returns LLM consensus config

GET http://localhost:3005/risk/gates
  → Returns active risk gate limits
```

### Example cURL:
```bash
# Switch to AUTO mode
curl -X POST http://localhost:3005/mode/trade

# Check current state
curl http://localhost:3005/state

# Get risk gate config
curl http://localhost:3005/risk/gates
```

---

## 📊 Running Services (All Background)

| Service | Port | Purpose |
|---------|------|---------|
| **Dashboard** | 3002 | Web UI + controls |
| **Trading Mode API** | 3005 | AUTO/MANUAL toggle |
| **Risk Gate** | 3001 | Position & leverage limits |
| **Signal Engine** | 3003 | Market signal generation |
| **Portfolio Manager** | 3004 | Position tracking |
| **Consensus Engine** | Internal | Multi-LLM orchestration |
| **Data Sourcer** | Internal | Market data fetching |
| **Trade Oversight** | Internal | Risk & execution monitor |

---

## 🧠 Multi-LLM Stack (Always Active)

Each LLM provides independent analysis:

1. **Claude (Anthropic)** - Complex financial reasoning
2. **GPT-4o (OpenAI)** - Market analysis & forecasting
3. **Gemini (Google)** - Multimodal analysis & web search
4. **OpenRouter** - Fallback models + cost optimization
5. **Azure OpenAI** - Backup redundancy

**Consensus Rule:** Need 4/5 agreements + 70% confidence to execute

---

## 🛡️ Risk Gates (Active in Both Modes)

```
Max Position Size:      $10,000
Max Portfolio Risk:      2% per trade
Max Leverage:           5x
Max Open Trades:        5
Stop Loss:              5%
Take Profit:            15%
Win Rate Gate:          70%
```

Overridden in MANUAL mode by manual review.

---

## 💻 Management Commands

### View all service logs:
```powershell
cd F:\aitradingagent\docker
docker compose logs -f
```

### View specific service:
```powershell
docker compose logs -f consensus-engine
docker compose logs -f risk-gate
docker compose logs -f dashboard
```

### Check running containers:
```powershell
docker compose ps
```

### Stop all services:
```powershell
# Double-click "AiTradingAgent Stop.lnk" on desktop
# OR manually:
docker compose down
```

### View trading state:
```powershell
Get-Content F:\aitradingagent\data\.trading_state | ConvertFrom-Json
```

---

## 📈 Trading Workflow

### MANUAL Mode Workflow:
```
1. Dashboard shows market analysis from all 5 LLMs
2. Consensus Engine aggregates signals → consensus score
3. Risk Gate evaluates position limits
4. Dashboard displays: Signal + Confidence + Risk Assessment
5. You review and click "Execute" button
6. Trade executes with your approval
```

### AUTO Mode Workflow:
```
1. Dashboard shows market analysis from all 5 LLMs
2. Consensus Engine aggregates signals → consensus score
3. Risk Gate evaluates position limits
4. If consensus > 70% AND risk gate approves:
   → Trade executes automatically
5. Dashboard logs execution
6. If rejected: Trade proposal logged, not executed
```

---

## 🔄 State Persistence

Trading state saved in: `F:\aitradingagent\data\.trading_state`

Contents:
```json
{
  "status": "RUNNING",
  "mode": "MANUAL",
  "start_time": "2026-08-28T10:30:00",
  "trade_count": 0,
  "last_toggle": "2026-08-28T10:31:00"
}
```

---

## ⚡ Performance Notes

- **First Launch:** 2-3 minutes (pulls Docker images, builds services)
- **Startup:** 30-60 seconds after launcher opens
- **Dashboard Response:** <500ms
- **Consensus Computation:** <2 seconds per market analysis
- **Trade Execution:** <5 seconds (including risk checks)

---

## 🆘 Troubleshooting

### Services won't start:
```powershell
# Check Docker Desktop is running
docker ps

# View full error logs
docker compose logs
```

### Consensus engine errors:
```powershell
# Check LLM API keys in .env
Get-Content F:\aitradingagent\.env | findstr "API_KEY"

# Verify API connectivity
curl https://api.openai.com/health
```

### Dashboard not loading:
```powershell
# Check if port 3002 is in use
netstat -ano | findstr 3002

# Restart dashboard service
docker compose restart dashboard
```

### Mode toggle not working:
```powershell
# Verify trading-mode-api service is running
docker compose logs trading-mode-api

# Check state file permissions
ls -la F:\aitradingagent\data\.trading_state
```

---

## 📝 Environment Variables

Key settings in `.env`:

```bash
# Trading Mode
TRADING_MODE=paper              # Change to "live" when ready

# Consensus
MIN_CONSENSUS_AGENTS=4          # Require 4/5 LLMs
MIN_CONFIDENCE=0.70             # 70% confidence threshold

# Risk Management
MAX_POSITION_SIZE=10000
MAX_PORTFOLIO_RISK=0.02
MAX_LEVERAGE=5
STOP_LOSS_PERCENT=5
TAKE_PROFIT_PERCENT=15

# LLM Selection
PRIMARY_MODEL=gpt-4o
SECONDARY_MODEL=claude-opus
```

---

## 🎯 Next Steps

1. **Test MANUAL mode first:**
   - Launch app with `AiTradingAgent.lnk`
   - Go to control panel: http://localhost:3002/trading-control.html
   - Review AI recommendations
   - Manually execute a few trades

2. **Monitor consensus engine:**
   - Watch dashboard for multi-LLM signals
   - Verify risk gate limits are enforced
   - Check trade logs for patterns

3. **Switch to AUTO mode when confident:**
   - Press TRADE button on control panel
   - System begins autonomous execution
   - Monitor dashboard continuously
   - Press STOP to return to MANUAL anytime

4. **Go live (optional):**
   - Edit `.env`: `TRADING_MODE=paper` → `TRADING_MODE=live`
   - Add real exchange API keys to `.env`
   - Restart services: `docker compose restart`
   - Monitor first 24 hours closely

---

## ✨ You're Ready!

Your background trading system is ready. Double-click **AiTradingAgent.lnk** on your desktop to start trading with multi-AI consensus and manual or autonomous execution modes.

Good luck! 🚀
