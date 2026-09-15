# data_export.py  ← place this in your project root (same level as config/, src/)
# ─────────────────────────────────────────────────────────────────────────────
# AI Trading Bot — Unified Data Export + LLM Analysis Bridge
# v2 — fully integrated with project modules
#
# WHAT IT DOES:
#   1. Pulls live DEX prices via DexScreener (your dexscreener_feed.py)
#   2. Detects arb opportunities (your cross_chain_arbitrage.py)
#   3. Runs gas gate (your gas_optimizer.py)
#   4. Asks your LLM router for analysis (your llm_router.py)
#   5. Exports everything to exports/ in JSON, CSV, JSONL formats
#
# USAGE:
#   python data_export.py              # full scan + export
#   python data_export.py --demo       # use simulated data (no API calls)
#   python data_export.py --no-llm     # skip LLM analysis step
#
# OUTPUT FILES (in ./exports/):
#   prices_raw_TIMESTAMP.json          — nested price dict
#   prices_flat_TIMESTAMP.csv          — one row per token/chain
#   opportunities_TIMESTAMP.csv        — arb opportunities
#   opportunities_TIMESTAMP.jsonl      — same, JSONL for LLM training
#   chain_metadata_TIMESTAMP.csv       — chain config reference
#   llm_analysis_TIMESTAMP.json        — LLM trading recommendations
#   ai_context_TIMESTAMP.json          — ready-to-paste AI prompt context
#   master_bundle_TIMESTAMP.json       — everything in one file
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import argparse
import csv
import datetime
import json
import logging
import os
import sys
import time
from typing import Optional

# ── Path setup — works from project root or any subdirectory ─────────────────
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__)))
sys.path.insert(0, PROJECT_ROOT)

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

logging.basicConfig(
    level   = logging.INFO,
    format  = "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt = "%H:%M:%S",
)
logger = logging.getLogger("data_export")

# ── Try importing project modules; graceful fallback if not available ─────────
_USE_PROJECT_MODULES = True

try:
    from config.chains import CHAINS, get_enabled_chains, get_low_fee_chains
    logger.info("✓ Loaded config.chains")
except ImportError:
    logger.warning("config.chains not found — using inline chain registry")
    _USE_PROJECT_MODULES = False

try:
    from src.data.dexscreener_feed import (
        get_token_prices_by_chain,
        get_multi_token_chain_prices,
    )
    _HAS_DEXSCREENER = True
    logger.info("✓ Loaded src.data.dexscreener_feed")
except ImportError:
    _HAS_DEXSCREENER = False
    logger.warning("dexscreener_feed not found — will use direct HTTP fallback")

try:
    from src.flashloan.cross_chain_arbitrage import (
        find_best_arb_pair,
        scan_all_tokens_all_chains,
        format_opportunity,
    )
    _HAS_ARB = True
    logger.info("✓ Loaded src.flashloan.cross_chain_arbitrage")
except ImportError:
    _HAS_ARB = False
    logger.warning("cross_chain_arbitrage not found — using inline detector")

try:
    from src.utils.gas_optimizer import is_trade_profitable, estimate_gas_cost_usd
    _HAS_GAS = True
    logger.info("✓ Loaded src.utils.gas_optimizer")
except ImportError:
    _HAS_GAS = False
    logger.warning("gas_optimizer not found — using inline gas estimator")

try:
    from core.llm_router import LLMRouter
    _HAS_LLM = True
    logger.info("✓ Loaded core.llm_router")
except ImportError:
    _HAS_LLM = False
    logger.warning("llm_router not found — LLM analysis will be skipped")

# ── Fallback inline chain registry (used if config.chains not importable) ─────
if not _USE_PROJECT_MODULES:
    import requests as _requests

    CHAINS = {
        "ethereum":  {"name":"Ethereum",         "chain_id":1,      "avg_gas_usd":2.50,  "color":"⚪","enabled":True, "primary_dex":"uniswap_v3",    "native_token":"ETH",  "dexscreener_id":"ethereum"},
        "polygon":   {"name":"Polygon",           "chain_id":137,    "avg_gas_usd":0.01,  "color":"🟣","enabled":True, "primary_dex":"quickswap",      "native_token":"MATIC","dexscreener_id":"polygon"},
        "cronos":    {"name":"Cronos",             "chain_id":25,     "avg_gas_usd":0.002, "color":"🔵","enabled":True, "primary_dex":"vvs_finance",    "native_token":"CRO",  "dexscreener_id":"cronos"},
        "arbitrum":  {"name":"Arbitrum One",       "chain_id":42161,  "avg_gas_usd":0.03,  "color":"🔷","enabled":True, "primary_dex":"uniswap_v3",    "native_token":"ETH",  "dexscreener_id":"arbitrum"},
        "base":      {"name":"Base",               "chain_id":8453,   "avg_gas_usd":0.001, "color":"🟦","enabled":True, "primary_dex":"baseswap",       "native_token":"ETH",  "dexscreener_id":"base"},
        "bsc":       {"name":"BNB Chain",          "chain_id":56,     "avg_gas_usd":0.10,  "color":"🟡","enabled":True, "primary_dex":"pancakeswap_v3", "native_token":"BNB",  "dexscreener_id":"bsc"},
        "avalanche": {"name":"Avalanche C-Chain",  "chain_id":43114,  "avg_gas_usd":0.05,  "color":"🔴","enabled":True, "primary_dex":"trader_joe",     "native_token":"AVAX", "dexscreener_id":"avalanche"},
    }
    def get_enabled_chains():   return {k:v for k,v in CHAINS.items() if v.get("enabled")}
    def get_low_fee_chains(m=0.10): return {k:v for k,v in CHAINS.items() if v.get("enabled") and v.get("avg_gas_usd",999)<=m}


# ── Config ────────────────────────────────────────────────────────────────────
OUTPUT_DIR         = os.path.join(PROJECT_ROOT, "exports")
SCAN_TOKENS        = ["ETH", "WBTC", "LINK", "AAVE", "BNB", "AVAX", "MATIC", "CRO"]
TRADE_AMOUNT_USD   = 1000.0
MIN_NET_PROFIT_PCT = 0.5
MIN_LIQUIDITY_USD  = 10_000
MIN_VOLUME_24H     = 5_000
REQUEST_TIMEOUT    = 12
RETRY_ATTEMPTS     = 3
RETRY_DELAY        = 1.5

TIMESTAMP = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S")

# ── Simulated data for --demo mode ────────────────────────────────────────────
DEMO_PRICES = {
    "ETH": {
        "ethereum":  {"price_usd":3521.00,"liquidity":5_000_000,"volume_24h":20_000_000,"dex":"uniswap_v3","chain":"ethereum","price_change_1h":0.12,"price_change_24h":-1.3,"buys_24h":12400,"sells_24h":10200,"avg_gas_usd":2.50,"chain_id":1},
        "arbitrum":  {"price_usd":3519.50,"liquidity":2_000_000,"volume_24h": 8_000_000,"dex":"uniswap_v3","chain":"arbitrum","price_change_1h":0.10,"price_change_24h":-1.2,"buys_24h":5200,"sells_24h":4800,"avg_gas_usd":0.03,"chain_id":42161},
        "polygon":   {"price_usd":3515.00,"liquidity":1_500_000,"volume_24h": 5_000_000,"dex":"quickswap", "chain":"polygon","price_change_1h":0.08,"price_change_24h":-1.4,"buys_24h":3100,"sells_24h":2900,"avg_gas_usd":0.01,"chain_id":137},
        "base":      {"price_usd":3522.00,"liquidity":  800_000,"volume_24h": 2_000_000,"dex":"baseswap",  "chain":"base",   "price_change_1h":0.15,"price_change_24h":-1.1,"buys_24h":1800,"sells_24h":1600,"avg_gas_usd":0.001,"chain_id":8453},
        "cronos":    {"price_usd":3490.00,"liquidity":  200_000,"volume_24h":   500_000,"dex":"vvs_finance","chain":"cronos","price_change_1h":-0.2,"price_change_24h":-2.1,"buys_24h":420,"sells_24h":380,"avg_gas_usd":0.002,"chain_id":25},
        "bsc":       {"price_usd":3518.00,"liquidity":1_000_000,"volume_24h": 3_000_000,"dex":"pancakeswap","chain":"bsc",  "price_change_1h":0.09,"price_change_24h":-1.3,"buys_24h":2800,"sells_24h":2600,"avg_gas_usd":0.10,"chain_id":56},
        "avalanche": {"price_usd":3512.00,"liquidity":  600_000,"volume_24h": 1_500_000,"dex":"trader_joe","chain":"avalanche","price_change_1h":0.07,"price_change_24h":-1.5,"buys_24h":1100,"sells_24h":980,"avg_gas_usd":0.05,"chain_id":43114},
    },
    "WBTC": {
        "ethereum":  {"price_usd":67850.00,"liquidity":8_000_000,"volume_24h":30_000_000,"dex":"uniswap_v3","chain":"ethereum","price_change_1h":0.05,"price_change_24h":0.8,"buys_24h":3200,"sells_24h":2800,"avg_gas_usd":2.50,"chain_id":1},
        "arbitrum":  {"price_usd":67820.00,"liquidity":3_000_000,"volume_24h":12_000_000,"dex":"uniswap_v3","chain":"arbitrum","price_change_1h":0.04,"price_change_24h":0.7,"buys_24h":1800,"sells_24h":1600,"avg_gas_usd":0.03,"chain_id":42161},
        "polygon":   {"price_usd":67760.00,"liquidity":1_200_000,"volume_24h": 4_000_000,"dex":"quickswap", "chain":"polygon","price_change_1h":0.02,"price_change_24h":0.6,"buys_24h":900,"sells_24h":800,"avg_gas_usd":0.01,"chain_id":137},
        "base":      {"price_usd":67870.00,"liquidity":  500_000,"volume_24h": 1_500_000,"dex":"baseswap",  "chain":"base",   "price_change_1h":0.06,"price_change_24h":0.9,"buys_24h":600,"sells_24h":520,"avg_gas_usd":0.001,"chain_id":8453},
    },
    "LINK": {
        "ethereum":  {"price_usd":14.92,"liquidity":2_000_000,"volume_24h":8_000_000,"dex":"uniswap_v3","chain":"ethereum","price_change_1h":0.3,"price_change_24h":2.1,"buys_24h":4200,"sells_24h":3800,"avg_gas_usd":2.50,"chain_id":1},
        "arbitrum":  {"price_usd":14.88,"liquidity":  900_000,"volume_24h":3_500_000,"dex":"uniswap_v3","chain":"arbitrum","price_change_1h":0.25,"price_change_24h":1.9,"buys_24h":2100,"sells_24h":1900,"avg_gas_usd":0.03,"chain_id":42161},
        "cronos":    {"price_usd":14.62,"liquidity":   80_000,"volume_24h":  200_000,"dex":"vvs_finance","chain":"cronos","price_change_1h":-0.1,"price_change_24h":1.2,"buys_24h":220,"sells_24h":190,"avg_gas_usd":0.002,"chain_id":25},
        "bsc":       {"price_usd":14.85,"liquidity":  600_000,"volume_24h":2_000_000,"dex":"pancakeswap","chain":"bsc","price_change_1h":0.2,"price_change_24h":1.8,"buys_24h":1800,"sells_24h":1600,"avg_gas_usd":0.10,"chain_id":56},
    },
}


# ── Fallback HTTP price fetcher (when dexscreener_feed.py not importable) ─────
def _fallback_fetch_prices(tokens: list) -> dict:
    """Direct DexScreener API calls — mirrors dexscreener_feed.py logic."""
    import requests
    BASE = "https://api.dexscreener.com/latest/dex"
    all_prices = {}

    for symbol in tokens:
        logger.info("  Fetching %s...", symbol)
        chain_prices = {}
        url  = f"{BASE}/search?q={symbol}%20USDC"
        data = None

        for attempt in range(RETRY_ATTEMPTS):
            try:
                resp = requests.get(url, headers={"User-Agent":"AiTradingAgent/1.0"}, timeout=REQUEST_TIMEOUT)
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as e:
                logger.warning("    Attempt %d failed: %s", attempt+1, e)
                if attempt < RETRY_ATTEMPTS - 1:
                    time.sleep(RETRY_DELAY)

        if not data:
            all_prices[symbol] = {}
            time.sleep(0.4)
            continue

        seen: dict = {}
        for pair in data.get("pairs") or []:
            chain = pair.get("chainId","")
            if chain not in CHAINS:
                continue
            liq = (pair.get("liquidity") or {}).get("usd") or 0
            vol = (pair.get("volume")    or {}).get("h24") or 0
            if liq < MIN_LIQUIDITY_USD or vol < MIN_VOLUME_24H:
                continue
            if chain not in seen or liq > seen[chain].get("liquidity", 0):
                ps = pair.get("priceUsd")
                if not ps:
                    continue
                try:
                    seen[chain] = {
                        "price_usd":       float(ps),
                        "liquidity":       liq,
                        "volume_24h":      vol,
                        "price_change_1h": (pair.get("priceChange") or {}).get("h1")  or 0,
                        "price_change_24h":(pair.get("priceChange") or {}).get("h24") or 0,
                        "dex":             pair.get("dexId","unknown"),
                        "pair_address":    pair.get("pairAddress",""),
                        "base_token":      (pair.get("baseToken") or {}).get("symbol",""),
                        "chain":           chain,
                        "chain_id":        CHAINS[chain]["chain_id"],
                        "avg_gas_usd":     CHAINS[chain]["avg_gas_usd"],
                        "token":           symbol,
                        "timestamp_utc":   datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        "buys_24h":        (pair.get("txns") or {}).get("h24",{}).get("buys",0),
                        "sells_24h":       (pair.get("txns") or {}).get("h24",{}).get("sells",0),
                    }
                except (ValueError, TypeError):
                    pass

        all_prices[symbol] = seen
        n = len(seen)
        logger.info("    ✓ %d chains: %s", n, list(seen.keys()))
        time.sleep(0.4)

    return all_prices


# ── Price collection ──────────────────────────────────────────────────────────
def collect_prices(tokens: list, demo: bool = False) -> dict:
    if demo:
        logger.info("[DEMO MODE] Using simulated price data")
        return DEMO_PRICES

    if _HAS_DEXSCREENER:
        logger.info("Using project dexscreener_feed module")
        return get_multi_token_chain_prices(tokens)
    else:
        logger.info("Using fallback HTTP fetcher")
        return _fallback_fetch_prices(tokens)


# ── Inline arb detector (fallback) ───────────────────────────────────────────
def _inline_detect_arb(all_prices: dict) -> list:
    """Mirrors cross_chain_arbitrage.scan_all_tokens_all_chains logic."""
    opps = []
    now  = datetime.datetime.now(datetime.timezone.utc).isoformat()

    for token, chain_prices in all_prices.items():
        chains = list(chain_prices.keys())
        for buy_chain in chains:
            for sell_chain in chains:
                if buy_chain == sell_chain:
                    continue
                bd = chain_prices[buy_chain]
                sd = chain_prices[sell_chain]
                bp = bd.get("price_usd", 0)
                sp = sd.get("price_usd", 0)
                if bp <= 0 or sp <= 0:
                    continue
                gross_pct = (sp - bp) / bp * 100
                if gross_pct <= 0:
                    continue
                buy_gas  = CHAINS.get(buy_chain,  {}).get("avg_gas_usd", 1.0)
                sell_gas = CHAINS.get(sell_chain, {}).get("avg_gas_usd", 1.0)
                gas_pct  = ((buy_gas + sell_gas) / TRADE_AMOUNT_USD) * 100
                net_pct  = gross_pct - gas_pct
                if net_pct < MIN_NET_PROFIT_PCT:
                    continue
                opps.append({
                    "timestamp_utc":    now,
                    "token":            token,
                    "buy_chain":        buy_chain,
                    "buy_chain_name":   CHAINS.get(buy_chain,{}).get("name", buy_chain),
                    "sell_chain":       sell_chain,
                    "sell_chain_name":  CHAINS.get(sell_chain,{}).get("name", sell_chain),
                    "buy_price":        round(bp,           4),
                    "sell_price":       round(sp,           4),
                    "buy_dex":          bd.get("dex",""),
                    "sell_dex":         sd.get("dex",""),
                    "gross_pct":        round(gross_pct,    4),
                    "gas_cost_pct":     round(gas_pct,      4),
                    "net_pct":          round(net_pct,      4),
                    "gross_usd_1k":     round((gross_pct/100)*TRADE_AMOUNT_USD, 4),
                    "net_usd_1k":       round((net_pct  /100)*TRADE_AMOUNT_USD, 4),
                    "buy_liquidity":    bd.get("liquidity",  0),
                    "sell_liquidity":   sd.get("liquidity",  0),
                    "buy_volume_24h":   bd.get("volume_24h", 0),
                    "sell_volume_24h":  sd.get("volume_24h", 0),
                    "opportunity":      True,
                    "trade_amount_usd": TRADE_AMOUNT_USD,
                })

    opps.sort(key=lambda x: x["net_pct"], reverse=True)
    return opps


# ── Opportunity detection ─────────────────────────────────────────────────────
def detect_opportunities(all_prices: dict) -> list:
    if _HAS_ARB:
        logger.info("Using project cross_chain_arbitrage module")
        raw = scan_all_tokens_all_chains(all_prices)
        # Enrich with usd estimates if not present
        for opp in raw:
            if "net_usd_1k" not in opp:
                opp["net_usd_1k"]   = round((opp["net_pct"]   / 100) * TRADE_AMOUNT_USD, 4)
                opp["gross_usd_1k"] = round((opp["gross_pct"] / 100) * TRADE_AMOUNT_USD, 4)
        return raw
    else:
        logger.info("Using inline arb detector")
        return _inline_detect_arb(all_prices)


# ── Gas gate ──────────────────────────────────────────────────────────────────
def apply_gas_gate(opportunities: list) -> tuple[list, list]:
    """Returns (actionable, below_threshold) lists."""
    if not _HAS_GAS:
        # Simple inline gate
        actionable = [o for o in opportunities if o.get("net_pct",0) >= MIN_NET_PROFIT_PCT and
                      (o.get("net_usd_1k",0) >= 1.0)]
        below      = [o for o in opportunities if o not in actionable]
        return actionable, below

    actionable, below = [], []
    for opp in opportunities:
        gate = is_trade_profitable(
            gross_profit_usd   = opp.get("gross_usd_1k", 0),
            chain_key_buy      = opp["buy_chain"],
            chain_key_sell     = opp["sell_chain"],
            min_net_profit_usd = 1.0,
        )
        opp["gate"] = gate
        (actionable if gate["profitable"] else below).append(opp)

    return actionable, below


# ── LLM Analysis ──────────────────────────────────────────────────────────────
def run_llm_analysis(opportunities: list, all_prices: dict) -> Optional[dict]:
    """Sends top opportunities to the LLM router for trade recommendations."""
    if not _HAS_LLM:
        logger.warning("LLM router not available — skipping analysis")
        return None

    try:
        router = LLMRouter.from_config()
    except Exception as e:
        logger.warning("Could not init LLMRouter: %s", e)
        return None

    top = opportunities[:5]
    if not top:
        logger.info("No opportunities to analyse")
        return None

    # Build price summary
    price_lines = []
    for token, chains in all_prices.items():
        prices_str = ", ".join(f"{c}=${d['price_usd']:,.2f}" for c,d in chains.items())
        price_lines.append(f"  {token}: {prices_str}")

    opp_lines = []
    for i, o in enumerate(top, 1):
        opp_lines.append(
            f"  {i}. {o['token']} BUY {o['buy_chain']} @${o['buy_price']:,.2f} → "
            f"SELL {o['sell_chain']} @${o['sell_price']:,.2f} | "
            f"net={o['net_pct']:.2f}% (${o['net_usd_1k']:.2f} on $1k trade)"
        )

    prompt = f"""You are an expert crypto arbitrage analyst for my multi-chain trading bot.

LIVE MARKET DATA ({datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}):
{chr(10).join(price_lines)}

TOP ARBITRAGE OPPORTUNITIES DETECTED:
{chr(10).join(opp_lines)}

Analyse these opportunities and provide:
1. RECOMMENDATION for each: EXECUTE / WATCH / SKIP — with brief reasoning
2. RISK FACTORS: liquidity depth, slippage risk, gas spike risk
3. PRIORITY ORDER: which to attempt first if capital is limited
4. MARKET CONTEXT: what the price spreads suggest about current market conditions
5. ONE KEY INSIGHT: something non-obvious about this data set

Keep analysis concise and actionable. Use your crypto market expertise."""

    logger.info("Sending opportunities to LLM router for analysis...")
    try:
        analysis_text = router.generate_text(prompt, max_tokens=1200)
        return {
            "timestamp_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "llm_provider":  str(router.default),
            "opportunities_analysed": len(top),
            "analysis":      analysis_text,
            "prompt_used":   prompt,
        }
    except Exception as e:
        logger.error("LLM analysis failed: %s", e)
        return {"error": str(e)}


# ── Exporters ─────────────────────────────────────────────────────────────────
def _ensure_dir():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

def _write_json(data, filename: str) -> str:
    path = os.path.join(OUTPUT_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)
    sz = os.path.getsize(path)
    logger.info("  JSON  → %s  (%s bytes)", filename, f"{sz:,}")
    return path

def _write_csv(rows: list, filename: str) -> str:
    if not rows:
        logger.info("  CSV   → %s  (no data)", filename)
        return ""
    path = os.path.join(OUTPUT_DIR, filename)
    # Flatten any nested dicts in rows
    flat = []
    for row in rows:
        flat_row = {}
        for k, v in row.items():
            if isinstance(v, dict):
                for kk, vv in v.items():
                    flat_row[f"{k}_{kk}"] = vv
            else:
                flat_row[k] = v
        flat.append(flat_row)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=flat[0].keys(), extrasaction="ignore")
        writer.writeheader()
        writer.writerows(flat)
    sz = os.path.getsize(path)
    logger.info("  CSV   → %s  (%s bytes, %d rows)", filename, f"{sz:,}", len(rows))
    return path

def _write_jsonl(rows: list, filename: str) -> str:
    if not rows:
        logger.info("  JSONL → %s  (no data)", filename)
        return ""
    path = os.path.join(OUTPUT_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, default=str) + "\n")
    sz = os.path.getsize(path)
    logger.info("  JSONL → %s  (%s bytes, %d records)", filename, f"{sz:,}", len(rows))
    return path

def build_chain_metadata() -> list:
    return [
        {
            "chain":        k,
            "name":         v["name"],
            "chain_id":     v["chain_id"],
            "avg_gas_usd":  v["avg_gas_usd"],
            "native_token": v.get("native_token","?"),
            "primary_dex":  v.get("primary_dex","?"),
            "enabled":      v.get("enabled", True),
            "gas_tier":     ("ultra_low" if v["avg_gas_usd"] <= 0.01 else
                             "low"       if v["avg_gas_usd"] <= 0.10 else
                             "medium"    if v["avg_gas_usd"] <= 1.00 else "high"),
        }
        for k, v in CHAINS.items()
    ]

def build_ai_context(all_prices, opportunities, llm_analysis=None) -> dict:
    top = opportunities[:10]
    price_summary = {
        token: {chain: round(d["price_usd"],2) for chain,d in chains.items()}
        for token, chains in all_prices.items()
    }
    summary_lines = [
        f"Snapshot: {datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        f"Tokens: {', '.join(SCAN_TOKENS)}",
        f"Chains: {', '.join(CHAINS.keys())}",
        f"Opportunities: {len(opportunities)} detected",
    ]
    if top:
        summary_lines.append("\nTop 3:")
        for o in top[:3]:
            summary_lines.append(
                f"  {o['token']} BUY {o['buy_chain']} @${o['buy_price']:,.2f} "
                f"→ SELL {o['sell_chain']} @${o['sell_price']:,.2f} | net={o['net_pct']:.2f}%"
            )
    return {
        "export_timestamp":       datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "export_version":         "2.0",
        "summary":                "\n".join(summary_lines),
        "prices_by_token":        price_summary,
        "top_opportunities":      top,
        "chain_metadata":         build_chain_metadata(),
        "llm_analysis":           llm_analysis,
        "scan_config": {
            "tokens":             SCAN_TOKENS,
            "trade_amount_usd":   TRADE_AMOUNT_USD,
            "min_net_profit_pct": MIN_NET_PROFIT_PCT,
            "min_liquidity_usd":  MIN_LIQUIDITY_USD,
            "project_modules":    {
                "chains":      _USE_PROJECT_MODULES,
                "dexscreener": _HAS_DEXSCREENER,
                "arb":         _HAS_ARB,
                "gas":         _HAS_GAS,
                "llm":         _HAS_LLM,
            },
        },
    }


# ── Main ──────────────────────────────────────────────────────────────────────
def run_export(demo: bool = False, no_llm: bool = False) -> dict:
    sep = "=" * 70

    print(sep)
    print("  AI TRADING BOT — UNIFIED DATA EXPORT v2")
    print(f"  {datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print(f"  Mode: {'DEMO' if demo else 'LIVE'}  |  LLM: {'OFF' if no_llm else 'ON'}")
    print(f"  Project modules: chains={_USE_PROJECT_MODULES} dex={_HAS_DEXSCREENER} "
          f"arb={_HAS_ARB} gas={_HAS_GAS} llm={_HAS_LLM}")
    print(sep)

    _ensure_dir()

    # 1 — Prices
    print("\n[1/5] Collecting live DEX prices...")
    all_prices = collect_prices(SCAN_TOKENS, demo=demo)
    total_data_points = sum(len(v) for v in all_prices.values())
    print(f"  ✓ {total_data_points} data points across {len(all_prices)} tokens")

    # 2 — Opportunities
    print("\n[2/5] Detecting arbitrage opportunities...")
    all_opps = detect_opportunities(all_prices)
    print(f"  ✓ {len(all_opps)} raw opportunities")

    # 3 — Gas gate
    print("\n[3/5] Applying profitability gate...")
    actionable, below = apply_gas_gate(all_opps)
    print(f"  ✓ {len(actionable)} actionable  |  {len(below)} below threshold")

    # 4 — LLM analysis
    llm_analysis = None
    if not no_llm and actionable:
        print("\n[4/5] Running LLM analysis...")
        llm_analysis = run_llm_analysis(actionable, all_prices)
        if llm_analysis and "analysis" in llm_analysis:
            print(f"  ✓ Analysis complete ({len(llm_analysis['analysis'])} chars)")
    else:
        print("\n[4/5] LLM analysis skipped")

    # 5 — Export
    print(f"\n[5/5] Exporting to {OUTPUT_DIR}/...")

    # Flat price rows for CSV
    price_rows = [
        {"token": token, "chain": chain, **data}
        for token, chains in all_prices.items()
        for chain, data in chains.items()
    ]

    chain_meta   = build_chain_metadata()
    ai_context   = build_ai_context(all_prices, all_opps, llm_analysis)
    master_bundle = {
        "meta": {
            "timestamp":          datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "export_version":     "2.0",
            "demo_mode":          demo,
            "tokens":             SCAN_TOKENS,
            "chains":             list(CHAINS.keys()),
            "total_price_points": total_data_points,
            "total_opportunities":len(all_opps),
            "actionable":         len(actionable),
        },
        "prices":         all_prices,
        "opportunities":  all_opps,
        "actionable":     actionable,
        "chain_metadata": chain_meta,
        "llm_analysis":   llm_analysis,
        "ai_context":     ai_context,
    }

    _write_json(all_prices,                      f"prices_raw_{TIMESTAMP}.json")
    _write_csv (price_rows,                      f"prices_flat_{TIMESTAMP}.csv")
    _write_csv (all_opps,                        f"opportunities_{TIMESTAMP}.csv")
    _write_jsonl(all_opps,                       f"opportunities_{TIMESTAMP}.jsonl")
    _write_csv (chain_meta,                      f"chain_metadata_{TIMESTAMP}.csv")
    _write_json(llm_analysis or {},              f"llm_analysis_{TIMESTAMP}.json")
    _write_json(ai_context,                      f"ai_context_{TIMESTAMP}.json")
    _write_json(master_bundle,                   f"master_bundle_{TIMESTAMP}.json")

    print(f"\n{sep}")
    print(f"  Export complete")
    print(f"  Tokens scanned:       {len(SCAN_TOKENS)}")
    print(f"  Price data points:    {total_data_points}")
    print(f"  Opportunities:        {len(all_opps)} detected, {len(actionable)} actionable")
    print(f"  Files written to:     {os.path.abspath(OUTPUT_DIR)}/")
    print(sep)

    if actionable:
        best = actionable[0]
        print(f"\n  🏆 Best opportunity:")
        print(f"  {best['token']}: {best['buy_chain_name']} → {best['sell_chain_name']}")
        print(f"  Net profit: {best['net_pct']:.2f}%  (${best['net_usd_1k']:.2f} on $1,000)")

    if llm_analysis and "analysis" in llm_analysis:
        print(f"\n  🤖 LLM Analysis Preview:")
        preview = llm_analysis["analysis"][:400]
        print("  " + preview.replace("\n", "\n  "))

    print()
    return master_bundle


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AI Trading Bot — Data Export")
    parser.add_argument("--demo",   action="store_true", help="Use simulated data (no API calls)")
    parser.add_argument("--no-llm", action="store_true", help="Skip LLM analysis")
    args = parser.parse_args()

    run_export(demo=args.demo, no_llm=args.no_llm)
