# src/flashloan/arbitrage_scanner.py
# ─────────────────────────────────────────────────────────────────────────────
# MASTER ARBITRAGE SCANNER — multi-chain edition
# UPDATED: Now publishes to Node.js engine at F:\aitradingagent via bridge
#
# Chains: Ethereum, Polygon, Cronos, Arbitrum, Base, BSC, Avalanche
# Price source: DexScreener (real DEX prices)
# PAPER TRADE MODE: analysis only — no transactions executed
#
# Alan J | barcay0611@gmail.com | github: smokey79
# ─────────────────────────────────────────────────────────────────────────────

import sys
import os
import json
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from src.data.dexscreener_feed           import get_multi_token_chain_prices
from src.flashloan.cross_chain_arbitrage import scan_all_tokens_all_chains, format_opportunity
from src.utils.gas_optimizer             import is_trade_profitable
from src.utils.slippage_control          import calculate_min_amount_out
from config.chains                       import chain_summary, get_low_fee_chains
from bridge.python_to_node               import BridgePublisher

# ── Config ────────────────────────────────────────────────────────────────────
SCAN_TOKENS        = ["ETH", "WBTC", "LINK", "AAVE", "BNB", "MATIC"]
TRADE_AMOUNT_USD   = float(os.getenv("TRADE_AMOUNT_USD",   "1000"))
MIN_NET_PROFIT_USD = float(os.getenv("MIN_NET_PROFIT_USD", "1.50"))
PAPER_TRADE_MODE   = os.getenv("PAPER_TRADE_MODE", "true").lower() == "true"
SCAN_INTERVAL_S    = int(os.getenv("SCAN_INTERVAL_S", "60"))

LOG_DIR  = os.path.join(os.path.dirname(__file__), "../../data")
LOG_FILE = os.path.join(LOG_DIR, "scan_log.jsonl")

# Bridge to Node.js
bridge = BridgePublisher()


def log_result(result: dict) -> None:
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(result) + "\n")


# ── Active-seeking: scan the historically most productive tokens first ────────
# 2026-09-15 — same idea as src/flashloan/opportunity_scout.py's
# rank_tokens_by_history(): re-order SCAN_TOKENS by how often each one has
# actually produced an actionable (gate-passing) opportunity in this
# scanner's own log, so the limited DexScreener free-tier call budget goes
# to the combos with a real track record first. Never drops a token, never
# invents history for one that has none — a brand-new token just keeps its
# original place in the list.
RANK_LOOKBACK_LINES = int(os.environ.get("SCANNER_RANK_LOOKBACK_LINES", "2000"))


def rank_tokens_by_history(tokens: list, log_path: str = LOG_FILE, lookback_lines: int = RANK_LOOKBACK_LINES) -> list:
    if not os.path.exists(log_path):
        return list(tokens)
    counts = {t: 0 for t in tokens}
    try:
        with open(log_path, "r") as f:
            lines = f.readlines()[-lookback_lines:]
        for line in lines:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("status") == "paper_logged" or entry.get("status") == "execution_triggered":
                token = entry.get("token")
                if token in counts:
                    counts[token] += 1
    except OSError:
        return list(tokens)
    return sorted(tokens, key=lambda t: -counts.get(t, 0))


def run_scan_cycle() -> list:
    """
    Runs one complete multi-chain arbitrage scan cycle.
    Publishes results to Node.js engine via BridgePublisher.
    """
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    scan_tokens = rank_tokens_by_history(SCAN_TOKENS)
    print("\n" + "="*80)
    print(f"  ARBITRAGE SCANNER — {timestamp}")
    print(f"  Mode: {'PAPER TRADE' if PAPER_TRADE_MODE else '⚠️  LIVE TRADE'}")
    print(f"  Tokens (most historically active first): {', '.join(scan_tokens)}")
    print("="*80)

    # Step 1: Fetch prices
    print("\n[1/4] Fetching live DEX prices via DexScreener...")
    try:
        token_chain_prices = get_multi_token_chain_prices(scan_tokens)
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
        opp["gate_result"]         = gate
        opp["estimated_trade_usd"] = TRADE_AMOUNT_USD
        opp["timestamp"]           = time.time()
        opp["paper_mode"]          = PAPER_TRADE_MODE

        if gate["profitable"]:
            opp["min_amount_out"] = calculate_min_amount_out(int(TRADE_AMOUNT_USD * 100), 0.01)
            opp["status"]         = "paper_logged" if PAPER_TRADE_MODE else "execution_triggered"
            actionable.append(opp)
        else:
            opp["status"] = "below_gas_threshold"

        log_result(opp)

    # Step 4: Publish to Node.js engine via bridge
    print(f"\n[4/4] Done — {len(actionable)}/{len(all_opps)} passed gate")
    if actionable:
        print("\n  ACTIONABLE OPPORTUNITIES:")
        for opp in actionable:
            print(format_opportunity(opp))

        # ── Publish to Node.js dashboard and orchestrator ─────────────────
        bridge.on_arb_scan(actionable)

        # ── Publish best opportunity as a trading decision ────────────────
        best = actionable[0]
        bridge.on_decision(
            symbol     = best["token"],
            action     = "LONG",
            size       = 0.3,
            reason     = (
                f"Arb: {best['buy_chain']}→{best['sell_chain']} "
                f"spread={best['net_pct']:.2f}%"
            ),
            source     = "arb_scanner",
            confidence = min(best["net_pct"] / 5.0, 1.0),  # scale 5% → 1.0
        )
    else:
        print("  No actionable opportunities this cycle.")
        # Still update portfolio state with zero opportunities
        bridge.on_arb_scan([])

    print("="*80 + "\n")
    return actionable


def run_continuous(interval_s: int = SCAN_INTERVAL_S) -> None:
    """Run scanner in a loop — call this from PM2 or as a standalone process."""
    print(f"[SCANNER] Starting continuous scan (interval={interval_s}s)")
    chain_summary()
    while True:
        try:
            run_scan_cycle()
        except KeyboardInterrupt:
            print("\n[SCANNER] Stopped by user.")
            break
        except Exception as e:
            print(f"[SCANNER] Unexpected error: {e}")
            log_result({"timestamp": time.time(), "status": "scan_error", "error": str(e)})
        time.sleep(interval_s)


if __name__ == "__main__":
    import sys
    if "--continuous" in sys.argv:
        run_continuous()
    else:
        chain_summary()
        opportunities = run_scan_cycle()
        if opportunities:
            best = opportunities[0]
            print(f"\nBest: {best['token']} "
                  f"{best['buy_chain']}→{best['sell_chain']} "
                  f"net={best['net_pct']:.2f}%")
