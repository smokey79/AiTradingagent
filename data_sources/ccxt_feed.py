"""
ccxt_feed.py
============
Live market data for the 7-token universe via CCXT.
Primary exchange: Binance (public)
Fallback exchange: Gate.io / KuCoin / Crypto.com for non-Binance symbols (e.g. CRO/USDT).
"""

import time
import logging
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any
import ccxt

logging.basicConfig(level=logging.INFO, format="%(asctime)s [CCXT] %(message)s")
log = logging.getLogger("CCXTFeed")

DEFAULT_SYMBOLS = [
    "BTC/USDT",
    "ETH/USDT",
    "CRO/USDT",
    "SOL/USDT",
    "AVAX/USDT",
    "ARB/USDT",
    "OP/USDT",
]


class CCXTFeed:
    """
    CCXT-powered market data provider with multi-exchange fallback.
    """

    def __init__(self, primary_exchange: str = "binance", fallback_exchange: str = "gate", symbols: Optional[List[str]] = None):
        self.symbols = symbols or DEFAULT_SYMBOLS
        self.primary_name = primary_exchange
        self.fallback_name = fallback_exchange

        primary_cls = getattr(ccxt, primary_exchange, ccxt.binance)
        fallback_cls = getattr(ccxt, fallback_exchange, ccxt.gate)

        self.primary = primary_cls({"enableRateLimit": True, "timeout": 2500})
        self.fallback = fallback_cls({"enableRateLimit": True, "timeout": 2500})
        log.info(f"Initialized CCXTFeed (Primary: {primary_exchange}, Fallback: {fallback_exchange})")

    def _fetch_from_exchanges(self, method_name: str, symbol: str, *args, **kwargs) -> Any:
        """Attempts primary exchange first, falls back if symbol is not supported."""
        try:
            method = getattr(self.primary, method_name)
            return method(symbol, *args, **kwargs)
        except (ccxt.BadSymbol, ccxt.ExchangeError) as e:
            try:
                method = getattr(self.fallback, method_name)
                return method(symbol, *args, **kwargs)
            except Exception as e_fallback:
                log.debug(f"{method_name} failed on primary ({e}) and fallback ({e_fallback}) for {symbol}")
                return None
        except Exception as e:
            log.warning(f"Error {method_name} for {symbol}: {e}")
            return None

    # ── Ticker ──────────────────────────────────────────────────────────────

    def get_ticker(self, symbol: str) -> Dict[str, Any]:
        """Fetch ticker with fallback."""
        t = self._fetch_from_exchanges("fetch_ticker", symbol)
        if not t:
            return {}
        try:
            return {
                "symbol": symbol,
                "price": float(t.get("last") or 0.0),
                "change_24h": float(t.get("percentage") or 0.0),
                "volume_24h": float(t.get("quoteVolume") or 0.0),
                "high_24h": float(t.get("high") or 0.0),
                "low_24h": float(t.get("low") or 0.0),
                "bid": float(t.get("bid") or 0.0),
                "ask": float(t.get("ask") or 0.0),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            log.error(f"Error parsing ticker for {symbol}: {e}")
            return {}

    def get_all_tickers(self) -> List[Dict[str, Any]]:
        """Fetch tickers for all configured symbols."""
        results = []
        for sym in self.symbols:
            data = self.get_ticker(sym)
            if data:
                results.append(data)
                log.info(f"  {sym:10s}: ${data['price']:,.4f} ({data['change_24h']:+.2f}%)")
            time.sleep(0.12)
        return results

    # ── OHLCV ───────────────────────────────────────────────────────────────

    def get_ohlcv(self, symbol: str, timeframe: str = "1h", limit: int = 100) -> List[Dict[str, Any]]:
        """Fetch OHLCV candles."""
        raw = self._fetch_from_exchanges("fetch_ohlcv", symbol, timeframe=timeframe, limit=limit)
        if not raw:
            return []
        candles = []
        for c in raw:
            try:
                candles.append({
                    "symbol": symbol,
                    "timestamp": datetime.fromtimestamp(c[0] / 1000, tz=timezone.utc).isoformat(),
                    "open": float(c[1]),
                    "high": float(c[2]),
                    "low": float(c[3]),
                    "close": float(c[4]),
                    "volume": float(c[5]),
                })
            except Exception:
                continue
        log.info(f"Fetched {len(candles)} {timeframe} candles for {symbol}")
        return candles

    def get_all_ohlcv(self, timeframe: str = "1h", limit: int = 100) -> Dict[str, List[Dict[str, Any]]]:
        """Fetch OHLCV for all tokens."""
        result = {}
        for sym in self.symbols:
            result[sym] = self.get_ohlcv(sym, timeframe=timeframe, limit=limit)
            time.sleep(0.15)
        return result

    # ── Order Book ──────────────────────────────────────────────────────────

    def get_order_book(self, symbol: str, depth: int = 10) -> Dict[str, Any]:
        """Fetch order book depth."""
        ob = self._fetch_from_exchanges("fetch_order_book", symbol, limit=depth)
        if not ob:
            return {}
        try:
            bids = ob.get("bids", [])
            asks = ob.get("asks", [])
            best_bid = float(bids[0][0]) if bids else None
            best_ask = float(asks[0][0]) if asks else None
            spread_pct = (
                ((best_ask - best_bid) / best_bid * 100)
                if (best_bid and best_ask and best_bid > 0)
                else None
            )
            return {
                "symbol": symbol,
                "best_bid": best_bid,
                "best_ask": best_ask,
                "spread_pct": round(spread_pct, 4) if spread_pct is not None else None,
                "bids": bids[:depth],
                "asks": asks[:depth],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            log.error(f"Error parsing order book for {symbol}: {e}")
            return {}

    def get_all(self, timeframe: str = "1h", ohlcv_limit: int = 100) -> Dict[str, Any]:
        """Complete market snapshot."""
        return {
            "tickers": self.get_all_tickers(),
            "ohlcv": self.get_all_ohlcv(timeframe=timeframe, limit=ohlcv_limit),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }


if __name__ == "__main__":
    feed = CCXTFeed()
    snapshot = feed.get_all(ohlcv_limit=10)
    print(f"\n✅ Fetched {len(snapshot['tickers'])} tickers")
