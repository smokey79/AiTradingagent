"""
DataAggregator — pulls live market data for all 7 tokens.
Sources (in priority order):
  1. Binance public REST API (UK-safe — public data only, no auth)
  2. DexScreener (DEX on-chain prices)
  3. CoinMarketCap (with API key)
Tokens: BTC, ETH, CRO, SOL, AVAX, ARB, OP
"""
import os
import time
import logging
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)

TARGET_TOKENS = ["BTC", "ETH", "CRO", "SOL", "AVAX", "ARB", "OP"]

# Binance symbol map (public REST — no API key, UK-safe)
BINANCE_SYMBOLS = {
    "BTC": "BTCUSDT", "ETH": "ETHUSDT", "CRO": "CROUSDT",
    "SOL": "SOLUSDT", "AVAX": "AVAXUSDT", "ARB": "ARBUSDT", "OP": "OPUSDT"
}

# DexScreener query terms
DEXSCREENER_PAIRS = {
    "CRO": "CRO", "ARB": "ARB", "OP": "OP"  # DEX tokens most relevant
}

CMC_KEY = os.getenv("COINMARKETCAP_API_KEY", "")


def fetch_binance_ticker(symbol: str, pair: str) -> dict:
    """Fetch 24hr ticker + klines from Binance public API."""
    base = "https://api.binance.com/api/v3"
    result = {"symbol": symbol, "source": "binance"}
    try:
        r24 = requests.get(f"{base}/ticker/24hr", params={"symbol": pair}, timeout=5)
        d = r24.json()
        result.update({
            "price": float(d.get("lastPrice", 0)),
            "price_change_24h_pct": float(d.get("priceChangePercent", 0)),
            "volume_24h": float(d.get("quoteVolume", 0)),
            "high_24h": float(d.get("highPrice", 0)),
            "low_24h": float(d.get("lowPrice", 0)),
        })
        # 1h klines for short-term momentum
        rk = requests.get(f"{base}/klines",
                          params={"symbol": pair, "interval": "1h", "limit": 24},
                          timeout=5)
        klines = rk.json()
        if klines:
            closes = [float(k[4]) for k in klines]
            result["closes_1h"] = closes
            # Simple RSI-14 approximation
            result["momentum_score"] = _simple_momentum(closes)
    except Exception as e:
        logger.warning(f"Binance fetch failed for {symbol}: {e}")
        result["error"] = str(e)
    return result


def fetch_dexscreener(token: str) -> dict:
    """Fetch on-chain DEX data from DexScreener."""
    try:
        url = f"https://api.dexscreener.com/latest/dex/search/?q={token}"
        r = requests.get(url, timeout=5)
        pairs = r.json().get("pairs", [])
        if pairs:
            top = pairs[0]
            return {
                "dex_price_usd": float(top.get("priceUsd", 0)),
                "dex_volume_24h": float(top.get("volume", {}).get("h24", 0)),
                "dex_liquidity": float(top.get("liquidity", {}).get("usd", 0)),
                "dex_price_change_5m": float(top.get("priceChange", {}).get("m5", 0)),
                "dex_source": top.get("dexId", "unknown"),
            }
    except Exception as e:
        logger.warning(f"DexScreener fetch failed for {token}: {e}")
    return {}


def _simple_momentum(closes: list) -> float:
    """
    Simple momentum score -1.0 to +1.0 based on price position
    relative to recent range (no TA-Lib dependency).
    """
    if len(closes) < 2:
        return 0.0
    low = min(closes)
    high = max(closes)
    if high == low:
        return 0.0
    latest = closes[-1]
    return round((latest - low) / (high - low) * 2 - 1, 3)


def get_all_market_data() -> dict:
    """
    Returns dict keyed by token symbol with all available data.
    Uses thread pool for parallel fetching.
    """
    market_data = {}

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {}
        for token, pair in BINANCE_SYMBOLS.items():
            f = executor.submit(fetch_binance_ticker, token, pair)
            futures[f] = ("binance", token)

        for token in DEXSCREENER_PAIRS:
            f = executor.submit(fetch_dexscreener, token)
            futures[f] = ("dex", token)

        for future in as_completed(futures):
            source, token = futures[future]
            try:
                result = future.result()
                if token not in market_data:
                    market_data[token] = {"symbol": token}
                market_data[token].update(result)
            except Exception as e:
                logger.error(f"Data fetch error {source}/{token}: {e}")

    # Add timestamp
    for token in market_data:
        market_data[token]["fetched_at"] = time.time()

    logger.info(f"[DATA] Fetched data for {list(market_data.keys())}")
    return market_data
