# AiTradingAgent 🤖

> **Multi-agent AI-powered arbitrage trading bot**  
> Cross-chain arbitrage detection across Ethereum and Polygon  
> Built with Python, Web3, Flashbots MEV protection, and GitHub Actions automation

---

## ⚠️ Status: Paper Trade Mode

All execution is currently **disabled**. The bot scans, detects, and logs opportunities — but does **not** send transactions until explicitly enabled after audit.

---

## Architecture

```
src/
├── data/
│   ├── price_feed.py          # Live prices from Binance + CoinGecko
│   ├── price_aggregator.py    # Cross-chain spread detection
│   └── dex_price_feed.py      # On-chain Uniswap/Sushiswap prices (Web3)
├── flashloan/
│   ├── arbitrage_scanner.py   # Master scanner — runs each cycle
│   ├── execute_arbitrage.py   # Execution (DISABLED until audit)
│   ├── flashbots_protection.py # MEV protection via Flashbots
│   └── cross_chain_arbitrage.py # ETH ↔ Polygon spread logic
└── utils/
    ├── gas_optimizer.py       # Dynamic gas pricing
    └── slippage_control.py    # Min output with slippage tolerance
tests/
    └── test_price_feed.py     # Unit tests (run on every push)
.github/workflows/
    ├── arbitrage_scan.yml     # Auto-scan every 5 minutes
    └── run_tests.yml          # Auto-test on every push
```

---

## Quick Start (Windows — VS Code)

### 1. Clone the repo

In VS Code, press `` Ctrl+` `` to open Terminal and run:

```bash
cd C:\Users\barcl\projects
git clone https://github.com/aitradingagentboa799/aitradingagentboa799.git AiTradingagent
cd AiTradingagent
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Set up your `.env` file

Copy the example file and fill in your keys:

```bash
copy .env.example .env
```

Then open `.env` in VS Code and fill in your values. **Never commit this file.**

### 4. Test the price feed

```bash
python src/data/price_feed.py
```

### 5. Run the full scanner (paper mode)

```bash
python src/flashloan/arbitrage_scanner.py
```

---

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `INFURA_URL` | Your Infura Ethereum RPC endpoint | ✅ Yes |
| `PRIVATE_KEY` | Wallet private key (never commit) | ✅ Yes |
| `POLYGON_RPC` | Polygon RPC endpoint | ✅ Yes |
| `FLASHBOTS_RELAY` | Flashbots relay URL | Optional |

Get a free Infura key at [infura.io](https://infura.io)

---

## GitHub Secrets Setup

For the GitHub Actions automation to work, you must add your keys as **GitHub Secrets** (not in code):

1. Go to your repo on GitHub
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add each variable from the table above

---

## Running Tests

```bash
python -m pytest tests/ -v
```

Tests run automatically on every `git push` via GitHub Actions.

---

## Safety Gates

Before any trade executes, **all** of these conditions must pass:

| Gate | Threshold | File |
|---|---|---|
| Minimum spread | ≥ 2.0% | `arbitrage_scanner.py` |
| Slippage tolerance | ≤ 1.0% | `slippage_control.py` |
| Gas buffer | +20% above base | `gas_optimizer.py` |
| Paper mode | Must be set `False` manually | `arbitrage_scanner.py` |

---

## Capital Constraint

This bot is designed for a **£250 constraint**. All position sizing respects this limit.  
See `config/` for configurable parameters.

---

## Roadmap

- [x] Live price feed (Binance + CoinGecko)
- [x] Cross-chain spread detection
- [x] GitHub Actions automation
- [x] Unit test suite
- [ ] On-chain DEX price feed (Uniswap V3)
- [ ] ORB (Opening Range Breakout) strategy integration
- [ ] Arbitrum chain support
- [ ] Dashboard UI
- [ ] Smart contract audit
- [ ] Live execution

---

## Security

- **No secrets in code** — all keys in `.env` (gitignored) or GitHub Secrets
- **Paper mode default** — no transactions without manual override
- **Flashbots** — MEV-protected bundle submission
- **Audit required** before any live capital deployment

---

*Built by Alan J — Edinburgh, Scotland*
