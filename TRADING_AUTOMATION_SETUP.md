# Automation & Manual Trading - Complete Setup Guide

## Overview

Your AI Trading Agent now supports THREE trading modes:

1. **🤖 AUTOMATION** — AI-driven automatic trading
2. **👆 MANUAL** — Complete user control
3. **🔄 HYBRID** — Both modes active (user can override AI)

All modes support:
- ✅ Paper trading (safe testing)
- ✅ Sandbox mode (Bitget testnet)
- ✅ Live mode (with confirmation if needed)
- ✅ Quick buy/sell buttons
- ✅ Pending confirmations
- ✅ Complete trade history

---

## Files Created

### Core Trading Engine
```
trading_mode_controller.py    Trading mode management
trading_api.py                REST API endpoints
web-dashboard/
  └── trading_controls.html   Web UI with buttons
```

### Key Features
- ✅ Manual trade execution
- ✅ Automation control
- ✅ Trade confirmations
- ✅ Quick action buttons
- ✅ Trade history tracking
- ✅ Real-time status updates

---

## Quick Start

### 1. Start the Trading API Server

```bash
cd F:\aitradingagent
python trading_api.py
```

Server starts on: **http://localhost:3003**

### 2. Open Trading Controls

Open in browser:
```
http://localhost:3003/static/trading_controls.html
```

Or access from web dashboard dashboard link.

### 3. Choose Your Mode

**Automation Mode:**
- AI makes trades automatically
- Optional confirmation required before execution
- Best for: Hands-off trading

**Manual Mode:**
- You control all trades
- Use quick buy/sell buttons
- Best for: Day trading, active monitoring

**Hybrid Mode:**
- Both AI and manual trades active
- Override AI decisions anytime
- Best for: Maximum flexibility

---

## API Endpoints

### Status Endpoints

```
GET /api/status                → Current status
GET /api/statistics            → Trading statistics
GET /api/health                → Health check
GET /api/mode                  → Current mode
```

### Mode Control

```
POST /api/mode/set             → Set mode (automation/manual/hybrid)
POST /api/trading/start        → Start trading
POST /api/trading/stop         → Stop trading
```

### Manual Trading

```
POST /api/trade/execute        → Execute custom trade
POST /api/trade/buy            → Quick buy
POST /api/trade/sell           → Quick sell
```

### Confirmations

```
GET /api/confirmations         → Get pending confirmations
POST /api/confirmations/<id>/approve  → Approve trade
POST /api/confirmations/<id>/reject   → Reject trade
```

### History

```
GET /api/trades                → Get trade history
GET /api/trades/<id>           → Get specific trade
```

---

## Example Usage

### Manual Trade via UI

1. Open trading_controls.html
2. Enter symbol (e.g., "BTC/USDT")
3. Enter amount (e.g., "0.01")
4. Click "QUICK BUY" or "QUICK SELL"

### Manual Trade via API

```bash
curl -X POST http://localhost:3003/api/trade/buy \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTC/USDT",
    "amount": 0.01,
    "price": 45000
  }'
```

### Switch to Automation Mode

```bash
curl -X POST http://localhost:3003/api/mode/set \
  -H "Content-Type: application/json" \
  -d '{"mode": "automation"}'
```

### Get Pending Confirmations

```bash
curl http://localhost:3003/api/confirmations
```

### Approve a Trade

```bash
curl -X POST http://localhost:3003/api/confirmations/{id}/approve
```

---

## Configuration

### Environment Variables

```env
# Trading Mode
TRADING_MODE=manual          # automation, manual, or hybrid
PAPER_TRADING=true           # false for live trading
MAX_TRADE_SIZE_USDT=100      # Maximum trade size
REQUIRE_CONFIRMATION=false   # Require manual confirmation for AI trades

# API
TRADING_API_PORT=3003
```

### Mode Descriptions

**AUTOMATION MODE**
```
- AI continuously generates trading signals
- Execute trades automatically
- Optional: Require user confirmation before each trade
- Best for: Algorithmic trading, hands-off operation
```

**MANUAL MODE**
```
- Only manual trades via UI/API
- AI signals visible but not executed
- Full user control
- Best for: Active traders, day trading
```

**HYBRID MODE**
```
- Both AI and manual trades active
- User can approve/reject AI trades
- User can execute manual trades anytime
- Best for: Maximum flexibility
```

---

## Web UI Features

### Trading Mode Selector
- 🤖 Automation
- 👆 Manual
- 🔄 Hybrid

### Quick Actions
- Buy/Sell buttons with preset amounts
- Quick 0.01, 0.05, 0.1 BTC buttons
- Custom symbol/amount input

### Manual Trading Panel
- Symbol input
- Amount input
- Price input (optional for market orders)
- Buy/Sell buttons

### Status Display
- Current mode
- Trading active/inactive
- Total trades executed
- System health

### Trade History
- Recent trades list
- Action (buy/sell)
- Amount and price
- Timestamp
- Trade status

### Pending Confirmations
- List of trades pending approval
- Approve/Reject buttons
- Trade details

---

## Safety Features

### Paper Trading Mode
- Default: Paper trading (no real money)
- All trades simulated
- No actual fund transfers
- Safe for testing

### Confirmation System
- Optional confirmation requirement
- Review trades before execution
- Approve or reject pending trades
- Audit trail of all actions

### Trade Limits
- Maximum trade size enforcement
- Configurable per-trade limits
- Prevents accidentally large trades
- Customizable thresholds

### Active Safeguards
- ✅ Paper trading by default
- ✅ Require confirmation option
- ✅ Trade size limits
- ✅ Mode switching capability
- ✅ Easy stop button
- ✅ Real-time status display

---

## Trade Execution Flow

### Manual Mode
```
User clicks "Buy" 
    ↓
Validates trade size
    ↓
Executes immediately (if paper mode)
    ↓
Returns confirmation + trade ID
    ↓
Updates history
```

### Automation with Confirmation
```
AI generates signal
    ↓
Queues for confirmation
    ↓
User sees pending trade
    ↓
User approves/rejects
    ↓
If approved: Execute
If rejected: Discard
```

### Automation (No Confirmation)
```
AI generates signal
    ↓
Executes immediately
    ↓
Returns trade ID
    ↓
User notified via UI
```

---

## Monitoring

### Real-time Dashboard
- Current mode displayed
- Trading status (active/inactive)
- Total trades count
- Pending confirmations count

### Trade History
- Timestamp of each trade
- Action (buy/sell)
- Amount and price
- Trade status (executed/pending)
- Auto-refreshes every 10 seconds

### Alerts
- Success alerts (green)
- Error alerts (red)
- Warning alerts (yellow)
- Paper trading warning banner

---

## Advanced Configuration

### Require Confirmation for AI Trades

```env
TRADING_MODE=automation
REQUIRE_CONFIRMATION=true    # User must approve each trade
```

Then AI trades appear in "Pending Confirmations" section.

### Live Trading Mode

```env
PAPER_TRADING=false          # ⚠️ REAL MONEY MODE
REQUIRE_CONFIRMATION=true    # MUST confirm each trade
MAX_TRADE_SIZE_USDT=100      # Start small
```

⚠️ **Use with extreme caution!**

### Hybrid Mode with Limits

```env
TRADING_MODE=hybrid
MAX_TRADE_SIZE_USDT=50       # Manual trades limited
REQUIRE_CONFIRMATION=true    # AI trades need approval
```

---

## Examples

### Example 1: Paper Trading with Manual Control

```env
TRADING_MODE=manual
PAPER_TRADING=true
```

- ✅ Safe to test
- ✅ Full UI control
- ✅ No real funds

### Example 2: Hybrid with AI Supervision

```env
TRADING_MODE=hybrid
REQUIRE_CONFIRMATION=true
PAPER_TRADING=true
```

- ✅ AI makes suggestions
- ✅ User approves each trade
- ✅ User can trade manually too
- ✅ Paper trading (safe)

### Example 3: Full Automation

```env
TRADING_MODE=automation
PAPER_TRADING=true
REQUIRE_CONFIRMATION=false
```

- ✅ AI trades autonomously
- ✅ User monitors only
- ✅ Paper trading (safe)

---

## Troubleshooting

### API Not Responding

```bash
# Check if API is running
curl http://localhost:3003/api/health

# Restart API
python trading_api.py
```

### Trades Not Executing

1. Check trading is active
   ```bash
   curl http://localhost:3003/api/status
   ```

2. Check mode is correct
   ```bash
   curl http://localhost:3003/api/mode
   ```

3. Check trade doesn't exceed limit
   ```env
   MAX_TRADE_SIZE_USDT=100  # Default limit
   ```

### UI Not Loading

- Ensure API is running on port 3003
- Check browser console for errors
- Try http://localhost:3003/static/trading_controls.html

---

## Performance Tips

- Paper trading is instant (no delays)
- Sandbox mode may have slight delays
- Live mode depends on exchange responsiveness
- Quick buttons for common amounts

---

## Next Steps

1. ✅ Start trading_api.py
2. ✅ Open trading_controls.html
3. ✅ Choose trading mode
4. ✅ Click "START TRADING"
5. ✅ Execute test trades
6. ✅ Monitor trade history
7. ✅ Switch modes as needed

---

## Support

API Documentation: http://localhost:3003/api/health  
UI Features: trading_controls.html  
Source Code: trading_mode_controller.py, trading_api.py  

