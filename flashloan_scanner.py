#!/usr/bin/env python3
"""
flashloan_scanner.py
Flash Loan Arbitrage Opportunity Scanner for AiTradingAgent

Paper-safe: in PAPER_TRADE_MODE=true, logs opportunities to trading.db only.
No on-chain execution in paper mode. Live execution requires a separate
execution layer (not implemented here -- signals feed into orchestrator).

Protocol : Aave v3 flash loans (0.05% fee)
Chains   : Arbitrum, Optimism, Avalanche (low gas + Aave v3 available)
Tokens   : ETH, ARB, OP, AVAX (from the 7-token target set)
Price src: DexScreener public API (free, no key required)
"""

import os
import json
import time
import logging
import sqlite3
import requests
from datetime import datetime, timezone
from itertools import combinations
from dotenv import load_dotenv
from pathlib import Path as _Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
# FIX 2026-09-13: was hardcoded to C:\Users\AlanJ\...\.env, a path that no
# longer exists (project was consolidated to F:\aitradingagent). Load the
# canonical .env sitting next to this script instead, so this always tracks
# wherever the project actually lives.
load_dotenv(dotenv_path=_Path(__file__).resolve().parent / ".env")

PAPER_MODE       = os.getenv("PAPER_TRADE_MODE", "true").lower() == "true"
DB_PATH          = os.getenv("DB_PATH", r"F:\aitradingagent\trading.db")
LOG_LEVEL        = os.getenv("LOG_LEVEL", "INFO")
SCAN_INTERVAL    = int(os.getenv("FLASHLOAN_SCAN_INTERVAL",  "30"))
MIN_PROFIT_USD   = float(os.getenv("FLASHLOAN_MIN_PROFIT_USD", "20.0"))
LOAN_SIZE_USD    = float(os.getenv("FLASHLOAN_LOAN_SIZE_USD",  "10000.0"))
GAS_COST_USD     = float(os.getenv("FLASHLOAN_GAS_USD",        "3.0"))

AAVE_FEE_PCT     = 0.0005   # Aave v3: 0.05%
DEX_FEE_PCT      = 0.003    # Typical AMM swap fee: 0.3%
MIN_LIQUIDITY    = 50_000   # Ignore DEX pairs with <$50k liquidity (slippage risk)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [FLASHLOAN] %(levelname)-8s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("flashloan_scanner")

# ---------------------------------------------------------------------------
# Token map: addresses for DexScreener queries
# Only chains where Aave v3 flash loans are available and gas is cheap
# ---------------------------------------------------------------------------
TOKEN_CONFIG = {
    "ETH": {
        "arbitrum": "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",  # WETH Arb
        "optimism": "0x4200000000000000000000000000000000000006",  # WETH OP
    },
    "ARB": {
        "arbitrum": "0x912CE59144191C1204E64559FE8253a0e49E6548",
    },
    "OP": {
        "optimism": "0x4200000000000000000000000000000000000042",
    },
    "AVAX": {
        "avalanche": "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",  # WAVAX
    },
}

DEXSCREENER_URL  = "https://api.dexscreener.com/latest/dex/tokens/{}"
STABLE_QUOTES    = {"USDC", "USDT", "DAI", "BUSD", "FRAX"}


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
def init_db():
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS flashloan_opportunities (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ts          TEXT    NOT NULL,
            token       TEXT    NOT NULL,
            chain       TEXT    NOT NULL,
            buy_dex     TEXT    NOT NULL,
            sell_dex    TEXT    NOT NULL,
            buy_price   REAL    NOT NULL,
            sell_price  REAL    NOT NULL,
            spread_pct  REAL    NOT NULL,
            loan_usd    REAL    NOT NULL,
            gross_pnl   REAL    NOT NULL,
            fees_usd    REAL    NOT NULL,
            net_pnl     REAL    NOT NULL,
            executed    INTEGER DEFAULT 0,
            paper_mode  INTEGER NOT NULL
        )
    """)
    con.commit()
    con.close()
    log.info("DB ready: %s", DB_PATH)

def log_opportunity(opp: dict):
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        INSERT INTO flashloan_opportunities
        (ts,token,chain,buy_dex,sell_dex,buy_price,sell_price,
         spread_pct,loan_usd,gross_pnl,fees_usd,net_pnl,executed,paper_mode)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?)
    """, (
        opp["ts"], opp["token"], opp["chain"],
        opp["buy_dex"], opp["sell_dex"],
        opp["buy_price"], opp["sell_price"],
        opp["spread_pct"], opp["loan_usd"],
        opp["gross_pnl"], opp["fees_usd"], opp["net_pnl"],
        int(PAPER_MODE),
    ))
    con.commit()
    con.close()

# ---------------------------------------------------------------------------
# Price fetching
# ---------------------------------------------------------------------------
def fetch_dex_prices(token: str, chain: str, address: str) -> list:
    """Return [{dex, price, liquidity}] from DexScreener for token/chain."""
    try:
        r = requests.get(DEXSCREENER_URL.format(address), timeout=10)
        r.raise_for_status()
        pairs = r.json().get("pairs") or []
        out = []
        for p in pairs:
            if p.get("chainId", "").lower() != chain.lower():
                continue
            if p.get("quoteToken", {}).get("symbol", "").upper() not in STABLE_QUOTES:
                continue
            price = float(p.get("priceUsd") or 0)
            liq   = float((p.get("liquidity") or {}).get("usd") or 0)
            if price <= 0 or liq < MIN_LIQUIDITY:
                continue
            out.append({"dex": p.get("dexId", "?"), "price": price, "liq": liq})
        return out
    except Exception as exc:
        log.warning("DexScreener fetch failed %s/%s: %s", token, chain, exc)
        return []

# ---------------------------------------------------------------------------
# Arbitrage P&L model
# ---------------------------------------------------------------------------
def calc_arb(buy_price: float, sell_price: float) -> dict:
    """
    Flash loan arb:
      1. Borrow LOAN_SIZE_USD from Aave (pay AAVE_FEE_PCT)
      2. Buy token on buy_dex  (pay DEX_FEE_PCT)
      3. Sell token on sell_dex (pay DEX_FEE_PCT)
      4. Repay loan + Aave fee
    Returns gross_pnl, fees_usd, net_pnl, spread_pct.
    """
    tokens_bought = (LOAN_SIZE_USD * (1 - DEX_FEE_PCT)) / buy_price
    proceeds      = tokens_bought * sell_price * (1 - DEX_FEE_PCT)
    gross_pnl     = proceeds - LOAN_SIZE_USD
    fees          = (LOAN_SIZE_USD * AAVE_FEE_PCT) + GAS_COST_USD
    net_pnl       = gross_pnl - fees
    spread_pct    = (sell_price - buy_price) / buy_price * 100
    return {
        "gross_pnl":  round(gross_pnl, 4),
        "fees_usd":   round(fees, 4),
        "net_pnl":    round(net_pnl, 4),
        "spread_pct": round(spread_pct, 4),
    }

# ---------------------------------------------------------------------------
# Main scan loop
# ---------------------------------------------------------------------------
def scan():
    mode_label = "PAPER" if PAPER_MODE else "LIVE (signals only)"
    log.info("Flash loan scanner started | mode=%s | min_profit=$%.0f | loan=$%.0f | interval=%ds",
             mode_label, MIN_PROFIT_USD, LOAN_SIZE_USD, SCAN_INTERVAL)
    init_db()

    while True:
        cycle_hits = 0
        for token, chains in TOKEN_CONFIG.items():
            for chain, address in chains.items():
                prices = fetch_dex_prices(token, chain, address)
                if len(prices) < 2:
                    continue
                for a, b in combinations(prices, 2):
                    for buy, sell in [(a, b), (b, a)]:
                        if buy["price"] >= sell["price"]:
                            continue
                        calc = calc_arb(buy["price"], sell["price"])
                        if calc["net_pnl"] < MIN_PROFIT_USD:
                            continue
                        cycle_hits += 1
                        opp = {
                            "ts":        datetime.now(timezone.utc).isoformat(),
                            "token":     token,
                            "chain":     chain,
                            "buy_dex":   buy["dex"],
                            "sell_dex":  sell["dex"],
                            "buy_price": buy["price"],
                            "sell_price":sell["price"],
                            "loan_usd":  LOAN_SIZE_USD,
                            **calc,
                        }
                        log.info(
                            "SIGNAL [%s] %s/%s | buy %s $%.4f -> sell %s $%.4f"
                            " | spread=%.3f%% | net=$%.2f",
                            mode_label, token, chain,
                            buy["dex"], buy["price"],
                            sell["dex"], sell["price"],
                            calc["spread_pct"], calc["net_pnl"],
                        )
                        log_opportunity(opp)

        if cycle_hits == 0:
            log.debug("No opportunities above $%.0f threshold this cycle.", MIN_PROFIT_USD)
        time.sleep(SCAN_INTERVAL)


if __name__ == "__main__":
    scan()
