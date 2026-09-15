# src/flashloan/arbitrage_scanner.py
# ─────────────────────────────────────────────────────────────────────────────
# MASTER ARBITRAGE SCANNER — multi-chain edition
# Chains: Ethereum, Polygon, Cronos, Arbitrum, Base, BSC, Avalanche
# Price source: DexScreener (real DEX prices)
# PAPER TRADE MODE: analysis only — no transactions executed
# ─────────────────────────────────────────────────────────────────────────────

import sys
import os
import json
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from src.data.dexscreener_feed           import get_multi_token_chain_prices
from src.flashloan.cross_chain_arbitrage import scan_all_tokens_all_chains, format_opportunity
from src.utils.gas_optimizer             import is_trade_profitable
try:
    from chains import chain_summary, get_low_fee_chains
except ImportError:
    from config.chains import chain_summary, get_low_fee_chains

# ── Config ────────────────────────────────────────────────────────────────────
SCAN_TOKENS        = ["ETH", "WBTC", "LINK", "AAVE"]
TRADE_AMOUNT_USD   = 1000.0
MIN_NET_PROFIT_USD = 1.50
PAPER_TRADE_MODE   = True     # ← NEVER set False without mainnet audit

LOG_DIR  = os.path.join(os.path.dirname(__file__), "../../data")
LOG_FILE = os.path.join(LOG_DIR, "scan_log.jsonl")


def log_result(result: dict) -> None:
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(result) + "\n")


def run_scan_cycle() -> list:
    """
    Runs one complete multi-chain arbitrage scan cycle.
    1. Fetch live DEX prices across all chains via DexScreener
    2. Detect cross-chain spread opportunities
    3. Apply gas profitability gate
    4. Log all results
    Returns actionable opportunities list.
    """
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    print("\n" + "="*80)
    print(f"  ARBITRAGE SCANNER — {timestamp}")
    print(f"  Mode: {'PAPER TRADE' if PAPER_TRADE_MODE else 'LIVE TRADE'}")
    print(f"  Tokens: {', '.join(SCAN_TOKENS)}")
    print("="*80)

    # Step 1: Fetch prices
    print("\n[1/4] Fetching live DEX prices via DexScreener...")
    try:
        token_chain_prices = get_multi_token_chain_prices(SCAN_TOKENS)
    except Exception as e:
        print(f"[SCANNER] Price fetch failed: {e}")
        log_result({"timestamp": time.time(), "status": "price_fetch_error", "error": str(e)})
        return []

    # Step 2: Detect opportunities
    print("\n[2/4] Detecting cross-chain spreads...")
    all_opps = scan_all_tokens_all_chains(token_chain_prices)
    print(f"  Raw opportunities: {len(all_opps)}")

    # Step 3: Gas gate
    print(f"\n[3/4] Applying gas gate (min net >= ${MIN_NET_PROFIT_USD})...")
    actionable = []
    for opp in all_opps:
        gross_usd = (opp["net_pct"] / 100) * TRADE_AMOUNT_USD
        gate = is_trade_profitable(
            gross_profit_usd   = gross_usd,
            chain_key_buy      = opp["buy_chain"],
            chain_key_sell     = opp["sell_chain"],
            min_net_profit_usd = MIN_NET_PROFIT_USD,
        )
        opp["gate_result"]        = gate
        opp["estimated_trade_usd"]= TRADE_AMOUNT_USD
        opp["timestamp"]          = time.time()
        opp["paper_mode"]         = PAPER_TRADE_MODE

        if gate["profitable"]:
            opp["min_amount_out"] = calculate_min_amount_out(int(TRADE_AMOUNT_USD * 100), 0.01)
            opp["status"]         = "paper_logged" if PAPER_TRADE_MODE else "execution_triggered"
            actionable.append(opp)
        else:
            opp["status"] = "below_gas_threshold"

        log_result(opp)

    # Step 4: Report
    print(f"\n[4/4] Done — {len(actionable)}/{len(all_opps)} passed gate")
    if actionable:
        print("\n  ACTIONABLE OPPORTUNITIES:")
        for opp in actionable:
            print(format_opportunity(opp))
    else:
        print("  No actionable opportunities this cycle.")
    print("="*80 + "\n")
    return actionable


if __name__ == "__main__":
    chain_summary()
    opportunities = run_scan_cycle()
    if opportunities:
        best = opportunities[0]
        print(f"Best: {best['token']} {best['buy_chain']}→{best['sell_chain']} net={best['net_pct']:.2f}%")
