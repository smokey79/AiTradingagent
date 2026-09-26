# src/flashloan/opportunity_scout.py
# ─────────────────────────────────────────────────────────────────────────────
# CROSS-CHAIN OPPORTUNITY SCOUT — broader than arbitrage_scanner.py
#
# arbitrage_scanner.py already answers ONE question well: "is there a price
# gap between chain A and chain B RIGHT NOW that survives gas costs?" This
# module looks for three other kinds of opportunity that a pure spread-scan
# misses entirely — the four patterns from claude/strategy-research-findings.md's
# honest conclusion that pure speed-based flash-loan arbitrage is dominated by
# MEV bots and compressed to razor-thin spreads for a solo retail operator:
#
#   1. bridge_latency_windows — a big price move on one chain that hasn't yet
#      propagated to another chain for the SAME token. Different from a
#      stable spread: this is a momentum-propagation lag, and it can appear
#      even when arbitrage_scanner's gross spread threshold isn't met yet.
#   2. yield_lp_opportunities — DEX pools with unusually high fee-turnover
#      (24h volume ÷ liquidity), which approximates LP fee-yield. Never a
#      trade signal — LPing has impermanent-loss risk this module doesn't
#      model — just a research lead worth a closer look.
#   3. new_listing_liquidity_gaps — tokens whose on-chain liquidity is
#      growing fast between consecutive scans (bootstrapping). HIGH RISK
#      (rug-pull territory) — flagged for awareness only, never a buy signal.
#   4. gas_optimized_routing — near-miss spreads that arbitrage_scanner's
#      MIN_NET_PROFIT_USD gate rejected, re-ranked by which chain PAIR has
#      the lowest combined gas cost right now — so you know which "almost"
#      opportunities are closest to becoming real if gas drops.
#
# PAPER_TRADE_SAFE: this module only ever reads prices and writes a log file.
# It has no execute_live() path and never should — see flash_loan_executor.py
# for why real flash-loan execution isn't viable for a solo retail operator.
# ─────────────────────────────────────────────────────────────────────────────

import sys
import os
import json
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from config.chains import CHAINS, get_enabled_chains
from src.data.dexscreener_feed import get_multi_token_chain_prices
from src.utils.gas_optimizer import estimate_gas_cost_usd, is_trade_profitable
from src.flashloan.cross_chain_arbitrage import find_best_arb_pair

# ── Config ────────────────────────────────────────────────────────────────────
SCAN_TOKENS = ["ETH", "WBTC", "LINK", "AAVE"]
TRADE_AMOUNT_USD = 1000.0

# Pattern 1: flag when one chain's 1h price move diverges from another chain's
# by more than this many percentage points for the same token — the gap
# hasn't shown up as a stable cross-chain spread yet, but the momentum has
# only reached one venue so far.
MOMENTUM_DIVERGENCE_PCT = 1.0

# Pattern 2: flag pools whose 24h volume is at least this multiple of their
# liquidity (a rough proxy for high fee turnover — NOT a real APR figure,
# real DEX pool fee tiers vary and this doesn't know them).
HIGH_TURNOVER_RATIO = 2.0

# Pattern 3: flag a token/chain if liquidity grew by at least this fraction
# since the last scan this process ran. Needs history, hence LIQUIDITY_HISTORY_PATH.
LIQUIDITY_GROWTH_THRESHOLD_PCT = 25.0

# Pattern 4: re-examine near-misses within this % of arbitrage_scanner's own
# MIN_NET_PROFIT_USD gate (see arbitrage_scanner.py) — i.e. spreads that
# failed the gate but not by much.
NEAR_MISS_USD_MARGIN = 3.0

LOG_DIR = os.path.join(os.path.dirname(__file__), "../../data")
LOG_FILE = os.path.join(LOG_DIR, "opportunity_scout_log.jsonl")
LIQUIDITY_HISTORY_PATH = os.path.join(LOG_DIR, "opportunity_scout_liquidity_history.json")


def _load_liquidity_history() -> dict:
    if not os.path.exists(LIQUIDITY_HISTORY_PATH):
        return {}
    try:
        with open(LIQUIDITY_HISTORY_PATH, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_liquidity_history(history: dict) -> None:
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(LIQUIDITY_HISTORY_PATH, "w") as f:
        json.dump(history, f, indent=2)


def _log(entry: dict) -> None:
    os.makedirs(LOG_DIR, exist_ok=True)
    entry["timestamp"] = time.time()
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")


# ── Active-seeking: prioritize tokens with a real history of findings ─────────
# 2026-09-15: "agents should actively seek better opportunities" for
# cross-chain, done honestly — this doesn't invent new opportunities, it
# just spends the DexScreener free-tier call budget on the token/chain
# combos that have ACTUALLY produced findings before, checking those
# first each cycle instead of a fixed list in a fixed order. A token with
# zero history keeps its place in SCAN_TOKENS (never penalized just for
# being new to the scan) — this only re-orders, never drops, a token.
RANK_LOOKBACK_LINES = int(os.environ.get("SCOUT_RANK_LOOKBACK_LINES", "2000"))


def rank_tokens_by_history(tokens: list, log_path: str = LOG_FILE, lookback_lines: int = RANK_LOOKBACK_LINES) -> list:
    """
    Reads the tail of this module's own finding log and counts findings
    per token, then returns `tokens` re-ordered so the ones with the most
    real historical findings are scanned first. Purely a scan-order
    optimization — never changes what counts as a finding, never invents
    activity for a token with no history.
    """
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
            token = entry.get("token")
            if token in counts:
                counts[token] += 1
    except OSError:
        return list(tokens)

    # Stable sort: ties (including all-zero, e.g. a brand-new token list)
    # keep their original relative order rather than being shuffled.
    return sorted(tokens, key=lambda t: -counts.get(t, 0))


# ── Pattern 1: bridge-latency / momentum-propagation windows ──────────────────

def find_momentum_divergence(token: str, chain_prices: dict) -> list:
    """
    Flags chain pairs where one chain's 1h price move is meaningfully larger
    than another's for the SAME token — a sign the move hasn't propagated
    yet. This is a LEAD to watch, not a trade signal: it can resolve by the
    lagging chain catching up (an arb opportunity opens) OR by the leading
    chain reverting (nothing to trade). Never assert which will happen.
    """
    findings = []
    chains = list(chain_prices.keys())
    for i in range(len(chains)):
        for j in range(len(chains)):
            if i == j:
                continue
            leader, lagger = chains[i], chains[j]
            move_leader = chain_prices[leader].get("price_change_1h", 0) or 0
            move_lagger = chain_prices[lagger].get("price_change_1h", 0) or 0
            divergence = move_leader - move_lagger
            if divergence >= MOMENTUM_DIVERGENCE_PCT:
                findings.append({
                    "pattern": "bridge_latency_window",
                    "token": token,
                    "leading_chain": leader,
                    "lagging_chain": lagger,
                    "leading_1h_move_pct": round(move_leader, 3),
                    "lagging_1h_move_pct": round(move_lagger, 3),
                    "divergence_pct": round(divergence, 3),
                    "note": "Momentum has reached the leading chain but not yet the lagging one. "
                            "Watch, don't trade on this alone — it may resolve either way.",
                })
    return findings


# ── Pattern 2: yield / LP fee-turnover opportunities ───────────────────────────

def find_high_turnover_pools(token: str, chain_prices: dict) -> list:
    """
    Flags pools with unusually high 24h-volume-to-liquidity ratio — a rough
    proxy for fee turnover, which can mean attractive LP fee yield. This is
    NOT a real APR (pool fee tiers differ and aren't modeled here) and NEVER
    a suggestion to actually provide liquidity — impermanent loss risk is
    entirely unmodeled by this scout. Research lead only.
    """
    findings = []
    for chain_key, data in chain_prices.items():
        liq = data.get("liquidity", 0) or 0
        vol = data.get("volume_24h", 0) or 0
        if liq <= 0:
            continue
        turnover = vol / liq
        if turnover >= HIGH_TURNOVER_RATIO:
            findings.append({
                "pattern": "high_turnover_pool",
                "token": token,
                "chain": chain_key,
                "chain_name": CHAINS.get(chain_key, {}).get("name", chain_key),
                "dex": data.get("dex", "unknown"),
                "turnover_ratio": round(turnover, 2),
                "liquidity_usd": round(liq, 2),
                "volume_24h_usd": round(vol, 2),
                "note": "High volume relative to pool size — a research lead for LP fee yield, "
                        "NOT a trade or LP recommendation. Impermanent-loss risk is not modeled here.",
            })
    return findings


# ── Pattern 3: new-listing / liquidity-bootstrap gaps ──────────────────────────

def find_liquidity_growth(token: str, chain_prices: dict, history: dict) -> list:
    """
    Compares this scan's liquidity against the last scan this process ran
    (persisted in LIQUIDITY_HISTORY_PATH) and flags fast growth — a proxy
    for a token/pool still bootstrapping liquidity. HIGH RISK: this pattern
    is indistinguishable from early rug-pull liquidity theatre without much
    deeper due diligence this scout does not attempt. Flag for awareness
    only — never a buy signal.
    """
    findings = []
    key_prefix = token
    for chain_key, data in chain_prices.items():
        liq_now = data.get("liquidity", 0) or 0
        hist_key = f"{key_prefix}:{chain_key}"
        liq_before = history.get(hist_key, {}).get("liquidity_usd")
        if liq_before and liq_before > 0:
            growth_pct = (liq_now - liq_before) / liq_before * 100
            if growth_pct >= LIQUIDITY_GROWTH_THRESHOLD_PCT:
                findings.append({
                    "pattern": "liquidity_bootstrap_gap",
                    "token": token,
                    "chain": chain_key,
                    "chain_name": CHAINS.get(chain_key, {}).get("name", chain_key),
                    "liquidity_before_usd": round(liq_before, 2),
                    "liquidity_now_usd": round(liq_now, 2),
                    "growth_pct": round(growth_pct, 1),
                    "note": "HIGH RISK — fast liquidity growth can mean genuine adoption OR early "
                            "rug-pull liquidity theatre. This scout cannot tell the difference. "
                            "Awareness only, never a buy signal.",
                })
        history[hist_key] = {"liquidity_usd": liq_now, "checked_at": time.time()}
    return findings


# ── Pattern 4: gas-optimized routing for near-miss spreads ────────────────────

def find_near_miss_routes(token: str, chain_prices: dict, min_net_profit_usd: float) -> list:
    """
    Re-examines spreads that DIDN'T clear arbitrage_scanner's profitability
    gate, and ranks them by which chain-pair currently has the cheapest
    combined gas — i.e. "closest to viable, and here's exactly how much
    closer gas would need to drop." Never flags something as actionable;
    the gate result gross_profit vs net_profit gap is the whole point.
    """
    findings = []
    all_pairs = find_best_arb_pair(chain_prices, token=token)
    for opp in all_pairs:
        gross_usd = (opp["gross_pct"] / 100) * TRADE_AMOUNT_USD
        gate = is_trade_profitable(
            gross_profit_usd=gross_usd,
            chain_key_buy=opp["buy_chain"],
            chain_key_sell=opp["sell_chain"],
            min_net_profit_usd=min_net_profit_usd,
        )
        shortfall = min_net_profit_usd - gate["net_profit_usd"]
        if not gate["profitable"] and 0 < shortfall <= NEAR_MISS_USD_MARGIN:
            findings.append({
                "pattern": "near_miss_route",
                "token": token,
                "buy_chain": opp["buy_chain"],
                "sell_chain": opp["sell_chain"],
                "gross_pct": opp["gross_pct"],
                "gas_cost_usd": gate["total_gas_usd"],
                "net_profit_usd": gate["net_profit_usd"],
                "shortfall_usd": round(shortfall, 4),
                "note": f"Failed the ${min_net_profit_usd} gate by only ${shortfall:.2f} of gas — "
                        "closest near-miss this cycle, worth re-checking if gas drops.",
            })
    findings.sort(key=lambda x: x["shortfall_usd"])
    return findings


# ── Orchestration ──────────────────────────────────────────────────────────────

def run_scout_cycle(tokens: list = None, min_net_profit_usd: float = 1.50) -> dict:
    """
    Runs all four pattern detectors for every configured token, logs every
    finding, and returns them grouped by pattern. Analysis/logging only —
    never places or suggests placing a real order.
    """
    tokens = rank_tokens_by_history(tokens or SCAN_TOKENS)
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    print("\n" + "=" * 80)
    print(f"  CROSS-CHAIN OPPORTUNITY SCOUT — {timestamp}")
    print(f"  Tokens (scanned in this order, most historically active first): {', '.join(tokens)}")
    print(f"  Chains: {len(get_enabled_chains())} enabled")
    print("=" * 80)

    history = _load_liquidity_history()
    results = {
        "bridge_latency_window": [],
        "high_turnover_pool": [],
        "liquidity_bootstrap_gap": [],
        "near_miss_route": [],
    }

    try:
        token_chain_prices = get_multi_token_chain_prices(tokens)
    except Exception as e:
        print(f"[SCOUT] Price fetch failed: {e}")
        _log({"status": "price_fetch_error", "error": str(e)})
        return results

    for token, chain_prices in token_chain_prices.items():
        if len(chain_prices) < 2:
            continue
        results["bridge_latency_window"].extend(find_momentum_divergence(token, chain_prices))
        results["high_turnover_pool"].extend(find_high_turnover_pools(token, chain_prices))
        results["liquidity_bootstrap_gap"].extend(find_liquidity_growth(token, chain_prices, history))
        results["near_miss_route"].extend(find_near_miss_routes(token, chain_prices, min_net_profit_usd))

    _save_liquidity_history(history)

    total = sum(len(v) for v in results.values())
    print(f"\n[SCOUT] {total} findings this cycle:")
    for pattern, items in results.items():
        print(f"  {pattern}: {len(items)}")
        for item in items:
            _log(item)

    print("=" * 80 + "\n")
    return results


if __name__ == "__main__":
    run_scout_cycle()
