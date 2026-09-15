# src/flashloan/cross_chain_arbitrage.py
# ─────────────────────────────────────────────────────────────────────────────
# Cross-chain arbitrage detector
# Updated to support: Ethereum, Polygon, Cronos, Arbitrum, Base, BSC, Avalanche
# Uses DexScreener as primary price source (real DEX prices, not CEX)
# PAPER TRADE SAFE — read-only analysis, no transactions
# ─────────────────────────────────────────────────────────────────────────────

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from config.chains import CHAINS, get_low_fee_chains

# ── Config ────────────────────────────────────────────────────────────────────
# Minimum spread % before flagging as opportunity (gross, before gas)
PROFIT_THRESHOLD_PCT = 1.5

# How much of spread must remain after gas to be considered viable
# e.g. if spread=3% and gas costs 1.5% equivalent → net = 1.5% → viable if ≥ 0.5%
MIN_NET_PROFIT_PCT = 0.5


# ── Core detection ────────────────────────────────────────────────────────────

def check_cross_chain_arbitrage(eth_price: float, polygon_price: float) -> dict:
    """
    Legacy 2-chain check (Ethereum vs Polygon).
    Kept for backward compatibility with existing tests.
    
    Args:
        eth_price: Price on Ethereum (float)
        polygon_price: Price on Polygon (float)
    Returns:
        Opportunity dict
    """
    if eth_price <= 0 or polygon_price <= 0:
        return {"opportunity": False, "reason": "Invalid price data"}

    if eth_price > polygon_price * (1 + PROFIT_THRESHOLD_PCT / 100):
        spread = (eth_price - polygon_price) / polygon_price * 100
        return {
            "opportunity": True,
            "buy_on":      "Polygon",
            "sell_on":     "Ethereum",
            "profit_pct":  round(spread, 4),
        }
    elif polygon_price > eth_price * (1 + PROFIT_THRESHOLD_PCT / 100):
        spread = (polygon_price - eth_price) / eth_price * 100
        return {
            "opportunity": True,
            "buy_on":      "Ethereum",
            "sell_on":     "Polygon",
            "profit_pct":  round(spread, 4),
        }
    else:
        return {"opportunity": False, "profit_pct": 0}


def find_best_arb_pair(chain_prices: dict, token: str = "ETH") -> list:
    """
    Given prices for a token across multiple chains, finds ALL viable
    buy-low / sell-high combinations, ranked by net profit.
    
    Accounts for gas costs so Ethereum high-fee doesn't eat the spread.
    
    Args:
        chain_prices: Dict from dexscreener_feed.get_token_prices_by_chain()
                      e.g. {"ethereum": {"price_usd": 3521, "liquidity": ...}, ...}
        token: Token symbol (used for logging only)
    Returns:
        List of opportunity dicts, sorted by net_profit_pct descending
    
    Example:
        opportunities = find_best_arb_pair(eth_prices, "ETH")
        # → [{"buy_chain": "cronos", "sell_chain": "arbitrum",
        #      "gross_pct": 2.1, "gas_cost_pct": 0.3, "net_pct": 1.8, ...}]
    """
    chains      = list(chain_prices.keys())
    opportunities = []

    if len(chains) < 2:
        return []

    for i in range(len(chains)):
        for j in range(len(chains)):
            if i == j:
                continue

            buy_chain  = chains[i]
            sell_chain = chains[j]

            buy_data  = chain_prices[buy_chain]
            sell_data = chain_prices[sell_chain]

            buy_price  = buy_data.get("price_usd", 0)
            sell_price = sell_data.get("price_usd", 0)

            if buy_price <= 0 or sell_price <= 0:
                continue

            # Gross spread
            gross_pct = (sell_price - buy_price) / buy_price * 100

            if gross_pct <= 0:
                continue   # No positive spread in this direction

            # Estimate gas cost as % of trade value
            # Use chain registry gas estimates
            buy_gas_usd  = CHAINS.get(buy_chain,  {}).get("avg_gas_usd", 1.0)
            sell_gas_usd = CHAINS.get(sell_chain, {}).get("avg_gas_usd", 1.0)
            total_gas    = buy_gas_usd + sell_gas_usd

            # Assume we're trading ~$1000 worth (£250 capital * 4x flash loan)
            trade_value_usd = 1000.0
            gas_cost_pct    = (total_gas / trade_value_usd) * 100

            net_pct = gross_pct - gas_cost_pct

            if gross_pct < PROFIT_THRESHOLD_PCT:
                continue
            if net_pct < MIN_NET_PROFIT_PCT:
                continue

            # Liquidity check — don't flag opportunity if pool is too shallow
            buy_liq  = buy_data.get("liquidity",  0)
            sell_liq = sell_data.get("liquidity", 0)
            min_liq  = min(buy_liq, sell_liq)

            opportunities.append({
                "token":          token,
                "buy_chain":      buy_chain,
                "buy_chain_name": CHAINS.get(buy_chain,  {}).get("name", buy_chain),
                "sell_chain":     sell_chain,
                "sell_chain_name":CHAINS.get(sell_chain, {}).get("name", sell_chain),
                "buy_price":      round(buy_price,  4),
                "sell_price":     round(sell_price, 4),
                "buy_dex":        buy_data.get("dex", ""),
                "sell_dex":       sell_data.get("dex", ""),
                "gross_pct":      round(gross_pct,    4),
                "gas_cost_pct":   round(gas_cost_pct, 4),
                "net_pct":        round(net_pct,      4),
                "min_liquidity":  round(min_liq,      2),
                "buy_volume_24h": buy_data.get("volume_24h", 0),
                "sell_volume_24h":sell_data.get("volume_24h", 0),
                "opportunity":    True,
            })

    # Sort by net profit — best first
    opportunities.sort(key=lambda x: x["net_pct"], reverse=True)
    return opportunities


def scan_all_tokens_all_chains(token_chain_prices: dict) -> list:
    """
    Runs find_best_arb_pair for every token in the price dict.
    
    Args:
        token_chain_prices: Nested dict from get_multi_token_chain_prices()
                            e.g. {"ETH": {"ethereum": {...}, "cronos": {...}}, ...}
    Returns:
        Flat list of all opportunities across all tokens, sorted by net_pct
    """
    all_opps = []
    for token, chain_prices in token_chain_prices.items():
        opps = find_best_arb_pair(chain_prices, token=token)
        all_opps.extend(opps)

    all_opps.sort(key=lambda x: x["net_pct"], reverse=True)
    return all_opps


def format_opportunity(opp: dict) -> str:
    """Returns a human-readable one-line summary of an opportunity."""
    buy_c  = CHAINS.get(opp["buy_chain"],  {}).get("color", "")
    sell_c = CHAINS.get(opp["sell_chain"], {}).get("color", "")
    return (
        f"  {opp['token']:6}  "
        f"BUY {buy_c} {opp['buy_chain_name']:<14} @ ${opp['buy_price']:>10,.2f}  "
        f"SELL {sell_c} {opp['sell_chain_name']:<14} @ ${opp['sell_price']:>10,.2f}  "
        f"gross={opp['gross_pct']:.2f}%  gas≈{opp['gas_cost_pct']:.2f}%  "
        f"NET={opp['net_pct']:.2f}%  "
        f"liq=${opp['min_liquidity']:>10,.0f}"
    )


# ── Run directly for testing ──────────────────────────────────────────────────
if __name__ == "__main__":
    # Simulated prices (replace with live DexScreener data in production)
    simulated_eth_prices = {
        "ethereum":  {"price_usd": 3521.00, "liquidity": 5_000_000, "volume_24h": 20_000_000, "dex": "uniswap_v3"},
        "arbitrum":  {"price_usd": 3519.50, "liquidity": 2_000_000, "volume_24h":  8_000_000, "dex": "uniswap_v3"},
        "polygon":   {"price_usd": 3515.00, "liquidity": 1_500_000, "volume_24h":  5_000_000, "dex": "quickswap"},
        "base":      {"price_usd": 3522.00, "liquidity":   800_000, "volume_24h":  2_000_000, "dex": "baseswap"},
        "cronos":    {"price_usd": 3490.00, "liquidity":   200_000, "volume_24h":    500_000, "dex": "vvs_finance"},
        "bsc":       {"price_usd": 3518.00, "liquidity": 1_000_000, "volume_24h":  3_000_000, "dex": "pancakeswap"},
        "avalanche": {"price_usd": 3512.00, "liquidity":   600_000, "volume_24h":  1_500_000, "dex": "trader_joe"},
    }

    print("\n" + "="*100)
    print("CROSS-CHAIN ARB DETECTOR TEST (simulated prices)")
    print("="*100)

    opps = find_best_arb_pair(simulated_eth_prices, "ETH")

    if opps:
        print(f"\nFound {len(opps)} viable opportunities:\n")
        for opp in opps:
            print(format_opportunity(opp))
    else:
        print("\nNo viable opportunities with simulated prices.")

    print("="*100 + "\n")
