# src/data/dexscreener_feed.py
# ─────────────────────────────────────────────────────────────────────────────
# DexScreener API — free, no API key required
# Covers: Ethereum, Polygon, Cronos, Arbitrum, Base, BSC, Avalanche + 40 more
#
# API docs: https://docs.dexscreener.com/api/reference
# Rate limit: 300 requests/minute (free tier)
#
# Key advantage over CoinGecko/Binance:
#   → Returns ACTUAL DEX liquidity pool prices, not CEX prices
#   → Shows liquidity depth, 24h volume, price impact
#   → Covers every chain in our registry without separate RPCs
# ─────────────────────────────────────────────────────────────────────────────

import time
import requests
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
DEXSCREENER_BASE  = "https://api.dexscreener.com/latest/dex"
REQUEST_TIMEOUT   = 10
RETRY_ATTEMPTS    = 3
RETRY_DELAY       = 1.5
MIN_LIQUIDITY_USD = 10_000    # Ignore pools with less than $10k liquidity
MIN_VOLUME_24H    = 5_000     # Ignore pairs with less than $5k 24h volume

# DexScreener chain identifiers (must match their API exactly)
DEXSCREENER_CHAINS = {
    "ethereum":  "ethereum",
    "polygon":   "polygon",
    "cronos":    "cronos",
    "arbitrum":  "arbitrum",
    "base":      "base",
    "bsc":       "bsc",
    "avalanche": "avalanche",
    "optimism":  "optimism",
    "fantom":    "fantom",
}

# Best known liquid pair addresses per chain for ETH/USDC
# These give the most reliable price quotes
BENCHMARK_PAIRS = {
    "ethereum":  "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640",  # Uniswap V3 ETH/USDC
    "polygon":   "0x45dda9cb7c25131df268515131f647d726f50608",  # Uniswap V3 ETH/USDC
    "cronos":    "0x814920d1b8007207db6cb5a2dd92bf0b082bdba1",  # VVS WCRO/USDC
    "arbitrum":  "0xc31e54c7a869b9fcbecc14363cf510d1c41fa443",  # Uniswap V3 ETH/USDC
    "base":      "0xd0b53d9277642d899df5c87a3966a349a798f224",  # BaseSwap ETH/USDC
    "bsc":       "0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae",  # PancakeSwap WBNB/USDC
    "avalanche": "0xf4003f4efbe8691b60249e6afbd307abe7758adb",  # Trader Joe WAVAX/USDC
}


# ── Core API calls ────────────────────────────────────────────────────────────

def _get(url: str) -> Optional[dict]:
    """
    Internal HTTP GET with retry logic.
    Returns parsed JSON dict or None on failure.
    """
    headers = {"User-Agent": "AiTradingAgent/1.0"}
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.HTTPError as e:
            print(f"[DEXSCREENER] HTTP {e.response.status_code} on attempt {attempt}: {url}")
            if e.response.status_code == 429:
                # Rate limited — wait longer
                time.sleep(RETRY_DELAY * 3)
        except requests.exceptions.ConnectionError:
            print(f"[DEXSCREENER] Connection error on attempt {attempt}")
        except requests.exceptions.Timeout:
            print(f"[DEXSCREENER] Timeout on attempt {attempt}")
        except Exception as e:
            print(f"[DEXSCREENER] Unexpected error: {e}")
            return None
        if attempt < RETRY_ATTEMPTS:
            time.sleep(RETRY_DELAY)
    return None


def get_pair_data(chain: str, pair_address: str) -> Optional[dict]:
    """
    Fetches full data for a specific liquidity pair on a given chain.
    
    Args:
        chain: Chain key e.g. "cronos", "base"
        pair_address: Pool/pair contract address
    Returns:
        Pair dict from DexScreener, or None
    
    Response fields of interest:
        priceUsd        → Current USD price of base token
        liquidity.usd   → Total liquidity in the pool
        volume.h24      → 24-hour trading volume
        priceChange.h1  → 1-hour price change %
        txns.h24.buys   → Buy transactions last 24h
        txns.h24.sells  → Sell transactions last 24h
    """
    dex_chain = DEXSCREENER_CHAINS.get(chain)
    if not dex_chain:
        print(f"[DEXSCREENER] Unknown chain: {chain}")
        return None

    url  = f"{DEXSCREENER_BASE}/pairs/{dex_chain}/{pair_address}"
    data = _get(url)
    if not data:
        return None

    pairs = data.get("pairs") or []
    if not pairs:
        print(f"[DEXSCREENER] No pair data found for {chain}/{pair_address}")
        return None

    pair = pairs[0]
    liq  = pair.get("liquidity", {}).get("usd", 0) or 0
    vol  = pair.get("volume",    {}).get("h24", 0) or 0

    if liq < MIN_LIQUIDITY_USD:
        print(f"[DEXSCREENER] ⚠️  Skipping {chain} pair — liquidity ${liq:,.0f} below ${MIN_LIQUIDITY_USD:,}")
        return None
    if vol < MIN_VOLUME_24H:
        print(f"[DEXSCREENER] ⚠️  Skipping {chain} pair — volume ${vol:,.0f} below ${MIN_VOLUME_24H:,}")
        return None

    return pair


def search_pairs(query: str, chain_filter: Optional[str] = None) -> list:
    """
    Searches DexScreener for pairs matching a query string.
    Optionally filters to a specific chain.
    
    Args:
        query: Token symbol or name e.g. "ETH", "WETH USDC"
        chain_filter: Optional chain key to filter results
    Returns:
        List of pair dicts sorted by liquidity descending
    
    Example:
        pairs = search_pairs("WETH", chain_filter="cronos")
    """
    url  = f"{DEXSCREENER_BASE}/search?q={query}"
    data = _get(url)
    if not data:
        return []

    pairs = data.get("pairs") or []

    # Filter by chain if requested
    if chain_filter:
        dex_chain = DEXSCREENER_CHAINS.get(chain_filter, chain_filter)
        pairs = [p for p in pairs if p.get("chainId") == dex_chain]

    # Filter out low-liquidity garbage
    pairs = [
        p for p in pairs
        if (p.get("liquidity", {}).get("usd") or 0) >= MIN_LIQUIDITY_USD
        and (p.get("volume", {}).get("h24") or 0) >= MIN_VOLUME_24H
    ]

    # Sort by liquidity — deepest pools are most reliable
    pairs.sort(
        key=lambda p: p.get("liquidity", {}).get("usd") or 0,
        reverse=True
    )

    return pairs


def get_token_prices_by_chain(token_symbol: str) -> dict:
    """
    Gets the best DEX price for a token on EVERY enabled chain.
    Returns a dict of {chain_key: price_data}.
    
    This is the primary function used by the arbitrage scanner.
    
    Args:
        token_symbol: e.g. "ETH", "WBTC", "LINK"
    Returns:
        dict of chain → {price_usd, liquidity, volume_24h, dex, pair_address}
    
    Example:
        prices = get_token_prices_by_chain("ETH")
        # → {
        #     "ethereum":  {"price_usd": 3521.40, "liquidity": 5000000, ...},
        #     "arbitrum":  {"price_usd": 3520.10, "liquidity": 2000000, ...},
        #     "cronos":    {"price_usd": 3515.00, "liquidity":  150000, ...},
        #   }
    """
    query  = f"{token_symbol} USDC"
    result = {}

    for chain_key in DEXSCREENER_CHAINS:
        pairs = search_pairs(query, chain_filter=chain_key)
        if not pairs:
            # Try benchmark pair as fallback
            benchmark = BENCHMARK_PAIRS.get(chain_key)
            if benchmark:
                pair = get_pair_data(chain_key, benchmark)
                pairs = [pair] if pair else []

        if pairs:
            best = pairs[0]   # Already sorted by liquidity — take deepest pool
            price_str = best.get("priceUsd")
            if price_str:
                try:
                    result[chain_key] = {
                        "price_usd":    float(price_str),
                        "liquidity":    best.get("liquidity", {}).get("usd") or 0,
                        "volume_24h":   best.get("volume",    {}).get("h24") or 0,
                        "price_change_1h": best.get("priceChange", {}).get("h1") or 0,
                        "dex":          best.get("dexId", "unknown"),
                        "pair_address": best.get("pairAddress", ""),
                        "base_token":   best.get("baseToken",  {}).get("symbol", ""),
                        "quote_token":  best.get("quoteToken", {}).get("symbol", ""),
                        "chain":        chain_key,
                    }
                    print(f"[DEXSCREENER] {chain_key:12} {token_symbol} = "
                          f"${float(price_str):>12,.4f}  "
                          f"liq=${result[chain_key]['liquidity']:>12,.0f}  "
                          f"dex={result[chain_key]['dex']}")
                except (ValueError, TypeError):
                    print(f"[DEXSCREENER] {chain_key}: invalid price '{price_str}'")
        else:
            print(f"[DEXSCREENER] {chain_key:12} {token_symbol} — no liquid pair found")

        time.sleep(0.25)   # Be gentle with the API

    return result


def get_multi_token_chain_prices(token_symbols: list) -> dict:
    """
    Gets prices for multiple tokens across all chains.
    Returns nested dict: {token: {chain: price_data}}
    
    Args:
        token_symbols: List e.g. ["ETH", "LINK", "BTC"]
    Returns:
        Nested price dict
    """
    all_prices = {}
    for symbol in token_symbols:
        print(f"\n[DEXSCREENER] Fetching {symbol} across all chains...")
        all_prices[symbol] = get_token_prices_by_chain(symbol)
        time.sleep(0.5)
    return all_prices


# ── Run directly for testing ──────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "="*65)
    print("DEXSCREENER FEED TEST")
    print("="*65)

    # Test 1: Single token across all chains
    print("\n── ETH price across all chains ─────────────────────────────")
    eth_prices = get_token_prices_by_chain("ETH")

    print(f"\n── Summary ({len(eth_prices)} chains responded) ─────────────────")
    for chain, data in sorted(eth_prices.items(), key=lambda x: -x[1]["price_usd"]):
        print(
            f"  {chain:12}  ${data['price_usd']:>10,.2f}  "
            f"liq=${data['liquidity']:>10,.0f}  "
            f"vol24h=${data['volume_24h']:>10,.0f}  "
            f"{data['dex']}"
        )

    # Test 2: Search for Cronos-specific pairs
    print("\n── Top Cronos pairs (search) ────────────────────────────────")
    cronos_pairs = search_pairs("WCRO", chain_filter="cronos")
    for p in cronos_pairs[:3]:
        print(
            f"  {p.get('baseToken',{}).get('symbol','?')}/{p.get('quoteToken',{}).get('symbol','?')}"
            f"  ${float(p.get('priceUsd',0) or 0):>10,.4f}"
            f"  liq=${p.get('liquidity',{}).get('usd',0):>10,.0f}"
            f"  {p.get('dexId','?')}"
        )

    print("="*65 + "\n")
