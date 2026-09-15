"""
ccxt_feed.py
============
Live market data for the 7-token universe via CCXT.

File location: C:\\Users\\AlanJ\\projects\\AiTradingagent\\data_sources\\ccxt_feed.py

Install first (run in terminal):
    pip install ccxt

Usage:
    from data_sources.ccxt_feed import CCXTFeed
    feed = CCXTFeed()
    data = feed.get_all()
"""

import ccxt
import time
import logging
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format="%(asctime)s [CCXT] %(message)s")
log = logging.getLogger(__name__)

# Your 7-token universe
SYMBOLS = [
    "BTC/USDT",
    "ETH/USDT",
    "CRO/USDT",
    "SOL/USDT",
    "AVAX/USDT",
    "ARB/USDT",
    "OP/USDT",
]

# Binance is free, no API key needed for market data
EXCHANGE = "binance"


class CCXTFeed:
    def __init__(self, exchange_id: str = EXCHANGE):
        exchange_class = getattr(ccxt, exchange_id)
        self.exchange = exchange_class({
            "enableRateLimit": True,   # respects exchange rate limits automatically
            "timeout": 10000,
        })
        log.info(f"Connected to {exchange_id}")

    # ── Ticker (current price + 24h stats) ─────────────────────────────────

    def get_ticker(self, symbol: str) -> dict:
        """Single ticker: price, 24h change %, volume."""
        try:
            t = self.exchange.fetch_ticker(symbol)
            return {
                "symbol":      symbol,
                "price":       t["last"],
                "change_24h":  t["percentage"],      # % change
                "volume_24h":  t["quoteVolume"],     # USDT volume
                "high_24h":    t["high"],
                "low_24h":     t["low"],
                "timestamp":   datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            log.error(f"Ticker error {symbol}: {e}")
            return {}

    def get_all_tickers(self) -> list[dict]:
        """Tickers for all 7 tokens."""
        results = []
        for sym in SYMBOLS:
            data = self.get_ticker(sym)
            if data:
                results.append(data)
                log.info(f"{sym}: ${data['price']:,.4f} ({data['change_24h']:+.2f}%)")
            time.sleep(0.2)   # gentle pacing
        return results

    # ── OHLCV candlestick data ──────────────────────────────────────────────

    def get_ohlcv(self, symbol: str, timeframe: str = "1h", limit: int = 100) -> list[dict]:
        """
        OHLCV candles.
        timeframe options: '1m','5m','15m','1h','4h','1d'
        limit: number of candles (max 1000)
        """
        try:
            raw = self.exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
            candles = []
            for c in raw:
                candles.append({
                    "symbol":    symbol,
                    "timestamp": datetime.fromtimestamp(c[0] / 1000, tz=timezone.utc).isoformat(),
                    "open":      c[1],
                    "high":      c[2],
                    "low":       c[3],
                    "close":     c[4],
                    "volume":    c[5],
                })
            log.info(f"Fetched {len(candles)} {timeframe} candles for {symbol}")
            return candles
        except Exception as e:
            log.error(f"OHLCV error {symbol}: {e}")
            return []

    def get_all_ohlcv(self, timeframe: str = "1h", limit: int = 100) -> dict:
        """OHLCV for all 7 tokens. Returns dict keyed by symbol."""
        result = {}
        for sym in SYMBOLS:
            result[sym] = self.get_ohlcv(sym, timeframe, limit)
            time.sleep(0.3)
        return result

    # ── Order book depth ───────────────────────────────────────────────────

    def get_order_book(self, symbol: str, depth: int = 10) -> dict:
        """Top N bids and asks — useful for liquidity checks."""
        try:
            ob = self.exchange.fetch_order_book(symbol, limit=depth)
            best_bid = ob["bids"][0][0] if ob["bids"] else None
            best_ask = ob["asks"][0][0] if ob["asks"] else None
            spread_pct = ((best_ask - best_bid) / best_bid * 100) if best_bid and best_ask else None
            return {
                "symbol":     symbol,
                "best_bid":   best_bid,
                "best_ask":   best_ask,
                "spread_pct": round(spread_pct, 4) if spread_pct else None,
                "bids":       ob["bids"][:depth],
                "asks":       ob["asks"][:depth],
            }
        except Exception as e:
            log.error(f"Order book error {symbol}: {e}")
            return {}

    # ── Convenience: full snapshot ──────────────────────────────────────────

    def get_all(self, timeframe: str = "1h", ohlcv_limit: int = 100) -> dict:
        """
        Full market snapshot for all tokens.
        Returns: { tickers, ohlcv }
        """
        log.info("Fetching full market snapshot...")
        return {
            "tickers": self.get_all_tickers(),
            "ohlcv":   self.get_all_ohlcv(timeframe, ohlcv_limit),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }


# ── Quick test ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    feed = CCXTFeed()
    snapshot = feed.get_all()
    print(f"\n✅ Fetched {len(snapshot['tickers'])} tickers")
    for t in snapshot["tickers"]:
        print(f"  {t['symbol']}: ${t['price']:,.4f} | 24h: {t['change_24h']:+.2f}%")
