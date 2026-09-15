# src/data/price_aggregator.py
# Aggregates prices from multiple sources and computes cross-chain spread
# This is what feeds directly into the arbitrage scanner

import time
from typing import Optional
from src.data.price_feed import get_price, get_multi_price

# ── Config ────────────────────────────────────────────────────────────────────
# Simulated Polygon price offset for paper trading
# In production this will be replaced by on-chain DEX price feed
POLYGON_SIMULATION_DISCOUNT = 0.97   # Polygon prices ~3% lower (example)

# Minimum spread % required before flagging an opportunity
MIN_SPREAD_PCT = 1.5


# ── Single token spread ───────────────────────────────────────────────────────
def get_cross_chain_spread(symbol: str) -> dict:
    """
    Gets price on Ethereum (CEX proxy) and Polygon (simulated for now).
    Returns spread data for the arbitrage scanner.
    
    Args:
        symbol: Token symbol e.g. "ETH"
    Returns:
        dict with eth_price, polygon_price, spread_pct, opportunity flag
    
    Note:
        polygon_price is currently simulated. Replace with dex_price_feed.py
        once your Web3 Polygon RPC is confirmed working.
    """
    eth_price = get_price(symbol, preferred_source="binance")

    if eth_price is None:
        return {
            "symbol": symbol,
            "eth_price": None,
            "polygon_price": None,
            "spread_pct": None,
            "opportunity": False,
            "error": "Price fetch failed",
        }

    # TODO: Replace this with real on-chain DEX price from dex_price_feed.py
    polygon_price = eth_price * POLYGON_SIMULATION_DISCOUNT

    spread_pct = (eth_price - polygon_price) / polygon_price * 100

    return {
        "symbol": symbol,
        "eth_price": round(eth_price, 4),
        "polygon_price": round(polygon_price, 4),
        "spread_pct": round(spread_pct, 4),
        "opportunity": spread_pct >= MIN_SPREAD_PCT,
        "buy_on": "Polygon" if eth_price > polygon_price else "Ethereum",
        "sell_on": "Ethereum" if eth_price > polygon_price else "Polygon",
        "source": "Binance CEX + Polygon simulated",
    }


def get_all_spreads(symbols: list) -> list:
    """
    Scans all supplied tokens for cross-chain spread opportunities.
    
    Args:
        symbols: list of token symbols e.g. ["ETH", "MATIC", "LINK"]
    Returns:
        list of spread dicts, sorted by spread_pct descending
    """
    results = []
    for symbol in symbols:
        spread = get_cross_chain_spread(symbol)
        results.append(spread)
        time.sleep(0.4)   # rate limit

    # Sort by spread — highest first
    results.sort(
        key=lambda x: x["spread_pct"] if x["spread_pct"] is not None else -999,
        reverse=True
    )
    return results


def get_market_snapshot() -> dict:
    """
    Returns a full market snapshot for all supported tokens.
    Used by the dashboard and scanner.
    
    Returns:
        dict with prices, spreads, timestamp
    """
    symbols = ["ETH", "BTC", "MATIC", "LINK", "AAVE", "UNI"]
    prices  = get_multi_price(symbols)
    spreads = get_all_spreads(["ETH", "MATIC", "LINK"])

    opportunities = [s for s in spreads if s.get("opportunity")]

    return {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "prices": prices,
        "spreads": spreads,
        "opportunities_found": len(opportunities),
        "opportunities": opportunities,
    }


# ── Run directly for testing ──────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "="*55)
    print("PRICE AGGREGATOR — MARKET SNAPSHOT")
    print("="*55)

    snapshot = get_market_snapshot()

    print(f"\nTimestamp : {snapshot['timestamp']}")
    print(f"Opportunities found: {snapshot['opportunities_found']}")

    print("\n── Prices ───────────────────────────────────────────")
    for sym, price in snapshot["prices"].items():
        val = f"${price:,.4f}" if price else "N/A"
        print(f"  {sym:6} {val}")

    print("\n── Spreads ──────────────────────────────────────────")
    for s in snapshot["spreads"]:
        flag  = "✅ OPPORTUNITY" if s["opportunity"] else "  no trade"
        spread = f"{s['spread_pct']:.2f}%" if s["spread_pct"] else "N/A"
        print(f"  {s['symbol']:6} spread={spread:8}  {flag}")

    print("="*55 + "\n")
