# src/data/price_feed.py
# Live price feed — pulls from CoinGecko (free, no key) and Binance (free, no key)
# Falls back to secondary source if primary fails
# PAPER TRADE MODE: safe to run — no transactions here

import os
import time
import requests
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
COINGECKO_BASE   = "https://api.coingecko.com/api/v3"
BINANCE_BASE     = "https://api.binance.com/api/v3"
REQUEST_TIMEOUT  = 10   # seconds before giving up on a request
RETRY_ATTEMPTS   = 3
RETRY_DELAY      = 2    # seconds between retries

# Map friendly symbol → CoinGecko ID and Binance pair
SUPPORTED_TOKENS = {
    "ETH":  {"coingecko_id": "ethereum",        "binance_pair": "ETHUSDT"},
    "BTC":  {"coingecko_id": "bitcoin",          "binance_pair": "BTCUSDT"},
    "MATIC":{"coingecko_id": "matic-network",    "binance_pair": "MATICUSDT"},
    "USDC": {"coingecko_id": "usd-coin",         "binance_pair": "USDCUSDT"},
    "LINK": {"coingecko_id": "chainlink",        "binance_pair": "LINKUSDT"},
    "UNI":  {"coingecko_id": "uniswap",          "binance_pair": "UNIUSDT"},
    "AAVE": {"coingecko_id": "aave",             "binance_pair": "AAVEUSDT"},
}


# ── CoinGecko ─────────────────────────────────────────────────────────────────
def fetch_price_coingecko(symbol: str) -> Optional[float]:
    """
    Fetches USD price from CoinGecko public API.
    No API key needed. Rate limit: ~30 calls/min free tier.
    
    Args:
        symbol: Token symbol e.g. "ETH", "BTC"
    Returns:
        float price in USD, or None on failure
    """
    token = SUPPORTED_TOKENS.get(symbol.upper())
    if not token:
        print(f"[COINGECKO] Unknown symbol: {symbol}")
        return None

    url = f"{COINGECKO_BASE}/simple/price"
    params = {
        "ids": token["coingecko_id"],
        "vs_currencies": "usd",
    }

    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            data = response.json()
            price = data[token["coingecko_id"]]["usd"]
            print(f"[COINGECKO] {symbol} = ${price:,.4f} USD")
            return float(price)
        except requests.exceptions.HTTPError as e:
            print(f"[COINGECKO] HTTP error on attempt {attempt}: {e}")
        except requests.exceptions.ConnectionError:
            print(f"[COINGECKO] Connection error on attempt {attempt}")
        except KeyError:
            print(f"[COINGECKO] Unexpected response format for {symbol}")
            return None
        if attempt < RETRY_ATTEMPTS:
            time.sleep(RETRY_DELAY)

    return None


# ── Binance ───────────────────────────────────────────────────────────────────
def fetch_price_binance(symbol: str) -> Optional[float]:
    """
    Fetches current price from Binance public ticker.
    No API key needed for public price data.
    
    Args:
        symbol: Token symbol e.g. "ETH", "BTC"
    Returns:
        float price in USD (USDT), or None on failure
    """
    token = SUPPORTED_TOKENS.get(symbol.upper())
    if not token:
        print(f"[BINANCE] Unknown symbol: {symbol}")
        return None

    url = f"{BINANCE_BASE}/ticker/price"
    params = {"symbol": token["binance_pair"]}

    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            price = float(response.json()["price"])
            print(f"[BINANCE]    {symbol} = ${price:,.4f} USDT")
            return price
        except requests.exceptions.HTTPError as e:
            print(f"[BINANCE] HTTP error on attempt {attempt}: {e}")
        except requests.exceptions.ConnectionError:
            print(f"[BINANCE] Connection error on attempt {attempt}")
        except (KeyError, ValueError):
            print(f"[BINANCE] Unexpected response format for {symbol}")
            return None
        if attempt < RETRY_ATTEMPTS:
            time.sleep(RETRY_DELAY)

    return None


# ── Main public function ───────────────────────────────────────────────────────
def get_price(symbol: str, preferred_source: str = "binance") -> Optional[float]:
    """
    Gets current USD price for a token.
    Tries preferred source first, falls back to secondary.
    
    Args:
        symbol: Token symbol e.g. "ETH"
        preferred_source: "binance" or "coingecko"
    Returns:
        float price in USD, or None if both sources fail
    """
    sources = (
        [fetch_price_binance, fetch_price_coingecko]
        if preferred_source == "binance"
        else [fetch_price_coingecko, fetch_price_binance]
    )

    for source_fn in sources:
        price = source_fn(symbol)
        if price is not None:
            return price

    print(f"[PRICE FEED] ⚠️  All sources failed for {symbol}")
    return None


def get_multi_price(symbols: list) -> dict:
    """
    Fetches prices for multiple tokens at once.
    
    Args:
        symbols: List of token symbols e.g. ["ETH", "BTC", "MATIC"]
    Returns:
        dict of {symbol: price} — failed symbols have None
    
    Example:
        prices = get_multi_price(["ETH", "MATIC"])
        # → {"ETH": 3521.40, "MATIC": 0.87}
    """
    results = {}
    for symbol in symbols:
        results[symbol] = get_price(symbol)
        time.sleep(0.3)   # gentle rate limit between calls
    return results


# ── Run directly for testing ──────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "="*55)
    print("LIVE PRICE FEED TEST")
    print("="*55)

    test_symbols = ["ETH", "BTC", "MATIC", "LINK"]
    prices = get_multi_price(test_symbols)

    print("\n── Summary ──────────────────────────────────────────")
    for sym, price in prices.items():
        status = f"${price:,.4f}" if price else "FAILED"
        print(f"  {sym:6} → {status}")
    print("="*55 + "\n")
