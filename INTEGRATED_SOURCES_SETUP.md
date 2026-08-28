# Integrated Data Sources Setup Guide

## Overview

Your AI trading agent now integrates:
- **Telegram** — Real-time trade notifications
- **CoinGecko** — Market data, trends, on-chain metrics
- **Bitget** — Live trading execution and portfolio management
- Plus existing: CCXT, SoSoValue, SD Card, Google Drive

---

## Setup Instructions

### 1. Telegram Bot Setup

#### a. Create Telegram Bot
1. Open Telegram and search for `@BotFather`
2. Send: `/start`
3. Send: `/newbot`
4. Choose a name (e.g., "AiTradingAgent")
5. Choose username (e.g., "@AiTradingAgent_Bot")
6. Copy the **API Token** provided

#### b. Get Your Chat ID
1. Start a chat with your bot
2. Send any message
3. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
   - Replace `<YOUR_BOT_TOKEN>` with your token
4. Look for `"chat":{"id":<YOUR_CHAT_ID>}`
5. Copy the **Chat ID**

#### c. Configure Environment
Update `.env`:
```env
TELEGRAM_BOT_TOKEN=<YOUR_BOT_TOKEN>
TELEGRAM_CHAT_ID=<YOUR_CHAT_ID>
```

#### d. Verify Connection
```python
from data_sources.telegram_notifier import TelegramNotifier
notifier = TelegramNotifier()
print(f"Telegram enabled: {notifier.enabled}")
```

---

### 2. CoinGecko Setup

#### a. Get API Key (Optional)
- Free tier: Works without API key (50 calls/minute)
- Pro tier: Get key at https://www.coingecko.com/api

#### b. Configure Environment
```env
COINGECKO_API_KEY=<YOUR_API_KEY>  # Optional
```

#### c. Verify Connection
```python
from data_sources.coingecko_feed import CoinGeckoFeed
cg = CoinGeckoFeed()
price = cg.get_price("bitcoin")
print(f"BTC Price: {price}")
```

---

### 3. Bitget Setup

#### a. Create Bitget Account
1. Register at https://www.bitget.com/
2. Enable 2FA for security
3. Go to Account Settings → API Management

#### b. Create API Keys
1. Click "Create" new API key
2. Set permissions:
   - ✅ Reading/Querying account data
   - ✅ Trading (for buy/sell)
   - ❌ Withdrawal (keep disabled for safety)
3. Copy:
   - **API Key**
   - **API Secret**
   - **Passphrase**

#### c. Configure Environment
```env
BITGET_API_KEY=<YOUR_API_KEY>
BITGET_SECRET=<YOUR_SECRET>
BITGET_API_PASSPHRASE=<YOUR_PASSPHRASE>
```

#### d. Enable Sandbox Testing
Default setup uses sandbox (testnet). To switch to live trading:

Edit `integrated_data_pipeline.py`:
```python
self.bitget = BitgetExchange(sandbox=False)  # Production mode
```

#### e. Verify Connection
```python
from data_sources.bitget_exchange import BitgetExchange
bitget = BitgetExchange(sandbox=True)
balance = bitget.get_balance()
print(f"Balance: {balance}")
```

---

## Usage Examples

### Example 1: Get Market Data from All Sources

```python
import asyncio
from integrated_data_pipeline import IntegratedDataPipeline

async def main():
    pipeline = IntegratedDataPipeline(
        use_telegram=True,
        use_coingecko=True,
        use_bitget=True,
    )
    
    package = await pipeline.run(
        symbol="BTC/USDT",
        send_notifications=True,
    )
    
    print(f"Data sources: {list(package['sources'].keys())}")
    print(f"Balance (Bitget): {package['sources']['bitget']['total_balance_usd']}")
    print(f"BTC Price (CoinGecko): {package['sources']['coingecko']['token']['market_data']['current_price']}")

asyncio.run(main())
```

### Example 2: Send Telegram Alert

```python
import asyncio
from data_sources.telegram_notifier import TelegramNotifier

async def main():
    notifier = TelegramNotifier()
    
    await notifier.send_trade_signal(
        symbol="ETH/USDT",
        action="BUY",
        confidence=0.82,
        price=2500,
        reason="RSI divergence + volume spike",
        metadata={"rsi": 65, "volume": "150% above avg"},
    )

asyncio.run(main())
```

### Example 3: Execute Trade on Bitget

```python
from data_sources.bitget_exchange import BitgetExchange

bitget = BitgetExchange(sandbox=True)

# Create market order
order = bitget.create_market_order(
    symbol="BTC/USDT",
    side="buy",
    amount=0.01,
)

print(f"Order ID: {order['id']}")
print(f"Status: {order['status']}")
```

### Example 4: Get Trending Tokens from CoinGecko

```python
from data_sources.coingecko_feed import CoinGeckoFeed

cg = CoinGeckoFeed()

# Get trending tokens
trending = cg.get_trending(5)
for token in trending:
    print(f"{token['item']['name']}: Rank {token['item']['market_cap_rank']}")

# Get global data
global_data = cg.get_global_data()
print(f"Total market cap: ${global_data['total_market_cap']['usd']:,.0f}")
print(f"BTC dominance: {global_data['btc_market_cap_percentage']['btc']:.2f}%")
```

---

## Data Flow Diagram

```
Integrated Pipeline
├── CCXT (Multiple Exchanges)
│   └── Spot/Futures Data
│
├── Telegram
│   ├── Trade Signals
│   ├── Portfolio Updates
│   └── Error Alerts
│
├── CoinGecko
│   ├── Price Data
│   ├── Market Trends
│   ├── Global Metrics
│   └── DeFi Data
│
├── Bitget Exchange
│   ├── Live Orders
│   ├── Portfolio Status
│   ├── Trade History
│   └── Account Balance
│
├── SoSoValue
│   └── Institutional Flows
│
├── On-Chain Analysis
│   ├── MVRV Proxy
│   ├── Volatility
│   └── Sector Rotation
│
└── External Data (SD Card + Google Drive)
    ├── Historical Backtests
    ├── ML Models
    └── Historical Data
```

---

## Configuration Options

### Environment Variables

```env
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# CoinGecko
COINGECKO_API_KEY=optional_pro_key

# Bitget
BITGET_API_KEY=your_api_key
BITGET_SECRET=your_secret
BITGET_API_PASSPHRASE=your_passphrase

# Trading Mode
TRADING_MODE=paper  # or live (use with caution!)
PAPER_TRADING=true
```

### Bitget Options

```python
# Sandbox (testnet) - Safe for testing
bitget = BitgetExchange(sandbox=True, trading_mode="spot")

# Production - Live trading (use with caution!)
bitget = BitgetExchange(sandbox=False, trading_mode="spot")

# Futures trading
bitget = BitgetExchange(sandbox=True, trading_mode="futures")
```

---

## Common Operations

### Send Portfolio Update via Telegram
```python
await telegram.send_portfolio_update(
    balance=5000.50,
    pnl=250.25,
    pnl_pct=5.2,
    positions=[
        {"symbol": "BTC/USDT", "quantity": 0.5, "entry_price": 45000},
        {"symbol": "ETH/USDT", "quantity": 5, "entry_price": 2500},
    ],
)
```

### Get Bitget Account Balance
```python
balance_dict = bitget.get_balance()
usdt_balance = balance_dict.get("USDT", {}).get("free", 0)
print(f"Available USDT: ${usdt_balance:,.2f}")
```

### Get CoinGecko Historical Data
```python
prices = cg.get_historical_data("bitcoin", days=30)
# Returns: [[timestamp, price], [timestamp, price], ...]
```

### Cancel Bitget Order
```python
cancelled = bitget.cancel_order(
    order_id="12345",
    symbol="BTC/USDT",
)
print(f"Cancelled: {cancelled['id']}")
```

---

## Troubleshooting

### Telegram Not Sending?
```python
notifier = TelegramNotifier()
print(f"Enabled: {notifier.enabled}")
print(f"Bot token: {notifier.bot_token is not None}")
print(f"Chat ID: {notifier.chat_id is not None}")
```

### CoinGecko Rate Limited?
- Free tier: 50 calls/minute
- Get Pro API key for unlimited
- Use caching (default 60s)

### Bitget Authentication Failed?
- Verify API credentials in `.env`
- Check API key permissions
- Ensure passphrase is correct
- Test in sandbox first

### Missing Dependencies?
```bash
pip install python-telegram-bot requests -U
```

---

## Safety Recommendations

⚠️ **IMPORTANT:**
1. **Test in sandbox first** before live trading
2. **Start with paper trading** to verify signals
3. **Use read-only API keys** for monitoring
4. **Restrict API permissions** (no withdrawal)
5. **Enable 2FA** on exchange account
6. **Use IP whitelisting** if available
7. **Never commit API keys** to git
8. **Rotate keys regularly**

---

## Next Steps

1. ✅ Set up Telegram bot (BotFather)
2. ✅ Add credentials to `.env`
3. ✅ Test CoinGecko: `python data_sources/coingecko_feed.py`
4. ✅ Test Bitget: `python data_sources/bitget_exchange.py`
5. ✅ Test Telegram: Run with `send_notifications=True`
6. ✅ Run integrated pipeline: `python integrated_data_pipeline.py`
7. ✅ Monitor logs for errors
8. ✅ Deploy to launcher

---

## Quick Test

```bash
# Install new dependencies
pip install -r requirements.txt -U

# Test all three integrations
cd F:\aitradingagent
python integrated_data_pipeline.py

# Expected output:
# - Market data from CCXT
# - Trending tokens from CoinGecko
# - Portfolio from Bitget (if configured)
# - Telegram notifications (if enabled)
```

---

## Support

**Telegram Docs:** https://core.telegram.org/bots/api  
**CoinGecko API:** https://docs.coingecko.com/reference/introduction  
**Bitget API:** https://bitgetlimited.github.io/apidoc/en/spot/

