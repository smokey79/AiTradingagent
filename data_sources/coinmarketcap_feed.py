"""
coinmarketcap_feed.py
=====================
CoinMarketCap Pro API integration for market data, multi-token quotes,
global crypto metrics, category data, and exchange rankings.
Includes built-in in-memory caching (TTL 60s) to conserve API credits.
"""

import os
import json
import logging
from typing import Dict, List, Optional, Any, Union
from datetime import datetime, timedelta
import requests

log = logging.getLogger("CoinMarketCapFeed")

BASE_URL = "https://pro-api.coinmarketcap.com/v1"
SANDBOX_URL = "https://sandbox-api.coinmarketcap.com/v1"
SANDBOX_KEY = "b54bcf4d-1bca-4e8e-9a24-22ff2c3d462c"


class CoinMarketCapFeed:
    """
    Fetches market data, quotes, rankings, and global metrics from CoinMarketCap Pro API.
    Supports in-memory caching to optimize API credit consumption.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        use_sandbox: bool = False,
        cache_ttl: int = 60,
    ):
        """
        Initialize CoinMarketCap feed.

        Args:
            api_key: Optional CoinMarketCap Pro API key. Defaults to CMC_API_KEY or COINMARKETCAP_API_KEY env vars.
            use_sandbox: Whether to use CoinMarketCap sandbox testing endpoint.
            cache_ttl: Cache time-to-live in seconds (default: 60s).
        """
        self.api_key = (
            api_key
            or os.getenv("CMC_API_KEY")
            or os.getenv("COINMARKETCAP_API_KEY", "")
        ).strip()
        
        self.use_sandbox = use_sandbox
        if self.use_sandbox:
            self.base_url = SANDBOX_URL
            self.api_key = self.api_key or SANDBOX_KEY
        else:
            self.base_url = BASE_URL

        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/json",
            "Accept-Encoding": "deflate, gzip",
            "User-Agent": "AiTradingAgent/1.0",
        })
        if self.api_key:
            self.session.headers["X-CMC_PRO_API_KEY"] = self.api_key

        self.cache: Dict[str, tuple[Any, datetime]] = {}
        self.cache_ttl = cache_ttl

        masked_key = f"{self.api_key[:6]}...{self.api_key[-4:]}" if len(self.api_key) > 10 else ("Configured" if self.api_key else "Missing")
        log.info(f"CoinMarketCap initialized | Key: {masked_key} | Sandbox: {self.use_sandbox} | Base URL: {self.base_url}")

    @property
    def is_configured(self) -> bool:
        """Returns True if a valid API key is present (not a placeholder)."""
        if not self.api_key:
            return False
        if any(self.api_key.lower().startswith(prefix) for prefix in ("your_", "sk-your", "placeholder", "xxx")):
            return False
        return True

    def _cache_key(self, endpoint: str, params: Dict[str, Any]) -> str:
        """Generate deterministic cache key."""
        param_str = json.dumps(params, sort_keys=True)
        return f"{endpoint}:{param_str}"

    def _get_cached(self, key: str) -> Optional[Any]:
        """Retrieve data from cache if not expired."""
        if key in self.cache:
            data, timestamp = self.cache[key]
            if datetime.now() < timestamp + timedelta(seconds=self.cache_ttl):
                return data
            else:
                del self.cache[key]
        return None

    def _set_cache(self, key: str, data: Any) -> None:
        """Store data in cache with current timestamp."""
        self.cache[key] = (data, datetime.now())

    def _get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """Internal GET helper with caching and error handling."""
        params = params or {}
        cache_key = self._cache_key(endpoint, params)
        cached = self._get_cached(cache_key)
        if cached is not None:
            return cached

        if not self.is_configured and not self.use_sandbox:
            log.warning(f"CoinMarketCap API key not set. Skipping {endpoint}")
            return None

        url = f"{self.base_url}{endpoint}"
        try:
            response = self.session.get(url, params=params, timeout=10)
            if response.status_code == 200:
                data = response.json()
                self._set_cache(cache_key, data)
                return data
            elif response.status_code == 401:
                log.error("CoinMarketCap API Key unauthorized or invalid (401)")
            elif response.status_code == 429:
                log.warning("CoinMarketCap rate limit exceeded (429)")
            else:
                log.error(f"CoinMarketCap request failed [{response.status_code}]: {response.text[:200]}")
        except requests.exceptions.RequestException as e:
            log.error(f"CoinMarketCap connection error on {endpoint}: {e}")
        except Exception as e:
            log.error(f"Unexpected error querying CoinMarketCap {endpoint}: {e}")
        return None

    def get_quotes(
        self,
        symbols: Union[str, List[str]] = "BTC,ETH,CRO,SOL,AVAX,ARB,OP",
        convert: str = "USD",
    ) -> Optional[Dict[str, Any]]:
        """
        Get latest market quotes for one or multiple cryptocurrency symbols.

        Args:
            symbols: Single symbol string ("BTC") or list/comma-separated string ("BTC,ETH,SOL")
            convert: Target currency (default: "USD")

        Returns:
            Dictionary of quotes keyed by symbol with price, volume, change%, and market cap.
        """
        if isinstance(symbols, list):
            symbol_str = ",".join(s.strip().upper() for s in symbols)
        else:
            symbol_str = ",".join(s.strip().upper() for s in symbols.split(","))

        endpoint = "/cryptocurrency/quotes/latest"
        params = {
            "symbol": symbol_str,
            "convert": convert.upper(),
        }

        res = self._get(endpoint, params)
        if not res or "data" not in res:
            return None

        data = res.get("data", {})
        parsed: Dict[str, Any] = {}
        for sym, item in data.items():
            quote_curr = item.get("quote", {}).get(convert.upper(), {})
            parsed[sym] = {
                "id": item.get("id"),
                "name": item.get("name"),
                "symbol": sym,
                "cmc_rank": item.get("cmc_rank"),
                "circulating_supply": item.get("circulating_supply"),
                "total_supply": item.get("total_supply"),
                "max_supply": item.get("max_supply"),
                "price": quote_curr.get("price"),
                "volume_24h": quote_curr.get("volume_24h"),
                "volume_change_24h": quote_curr.get("volume_change_24h"),
                "percent_change_1h": quote_curr.get("percent_change_1h"),
                "percent_change_24h": quote_curr.get("percent_change_24h"),
                "percent_change_7d": quote_curr.get("percent_change_7d"),
                "percent_change_30d": quote_curr.get("percent_change_30d"),
                "market_cap": quote_curr.get("market_cap"),
                "market_cap_dominance": quote_curr.get("market_cap_dominance"),
                "last_updated": quote_curr.get("last_updated") or item.get("last_updated"),
            }
        return parsed

    def get_price(self, symbol: str, convert: str = "USD") -> Optional[Dict[str, Any]]:
        """
        Get price and 24h summary for a single coin.

        Args:
            symbol: Cryptocurrency symbol e.g., "BTC" or "BTC/USDT"
            convert: Target currency (default: "USD")

        Returns:
            Dict containing price, volume, change%, and market cap
        """
        clean_symbol = symbol.split("/")[0].strip().upper()
        quotes = self.get_quotes(symbols=clean_symbol, convert=convert)
        if quotes and clean_symbol in quotes:
            return quotes[clean_symbol]
        return None

    def get_global_metrics(self, convert: str = "USD") -> Optional[Dict[str, Any]]:
        """
        Get global cryptocurrency market metrics.

        Returns:
            Dict containing total market cap, 24h volume, BTC/ETH dominance, active cryptos, etc.
        """
        endpoint = "/global-metrics/quotes/latest"
        params = {"convert": convert.upper()}

        res = self._get(endpoint, params)
        if not res or "data" not in res:
            return None

        d = res.get("data", {})
        quote_curr = d.get("quote", {}).get(convert.upper(), {})

        return {
            "active_cryptocurrencies": d.get("active_cryptocurrencies"),
            "total_cryptocurrencies": d.get("total_cryptocurrencies"),
            "active_market_pairs": d.get("active_market_pairs"),
            "active_exchanges": d.get("active_exchanges"),
            "btc_dominance": d.get("btc_dominance"),
            "eth_dominance": d.get("eth_dominance"),
            "btc_dominance_24h_percentage_change": d.get("btc_dominance_24h_percentage_change"),
            "eth_dominance_24h_percentage_change": d.get("eth_dominance_24h_percentage_change"),
            "defi_volume_24h": d.get("defi_volume_24h"),
            "defi_market_cap": d.get("defi_market_cap"),
            "stablecoin_volume_24h": d.get("stablecoin_volume_24h"),
            "stablecoin_market_cap": d.get("stablecoin_market_cap"),
            "total_market_cap": quote_curr.get("total_market_cap"),
            "total_volume_24h": quote_curr.get("total_volume_24h"),
            "total_market_cap_yesterday_percentage_change": quote_curr.get("total_market_cap_yesterday_percentage_change"),
            "last_updated": quote_curr.get("last_updated") or d.get("last_updated"),
        }

    def get_latest_listings(
        self,
        limit: int = 20,
        sort: str = "market_cap",
        sort_dir: str = "desc",
        convert: str = "USD",
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Get ranked list of all active cryptocurrencies with latest market data.

        Args:
            limit: Number of results to return (1-5000, default 20)
            sort: Sort criteria ('market_cap', 'name', 'symbol', 'date_added', 'price', 'circulating_supply', 'total_supply', 'max_supply', 'num_market_pairs', 'volume_24h', 'percent_change_1h', 'percent_change_24h', 'percent_change_7d')
            sort_dir: Sort direction ('asc', 'desc')
            convert: Target currency (default "USD")

        Returns:
            List of coin dictionaries
        """
        endpoint = "/cryptocurrency/listings/latest"
        params = {
            "limit": limit,
            "sort": sort,
            "sort_dir": sort_dir,
            "convert": convert.upper(),
        }

        res = self._get(endpoint, params)
        if not res or "data" not in res:
            return None

        coins = []
        for item in res.get("data", []):
            q = item.get("quote", {}).get(convert.upper(), {})
            coins.append({
                "id": item.get("id"),
                "name": item.get("name"),
                "symbol": item.get("symbol"),
                "cmc_rank": item.get("cmc_rank"),
                "price": q.get("price"),
                "volume_24h": q.get("volume_24h"),
                "percent_change_1h": q.get("percent_change_1h"),
                "percent_change_24h": q.get("percent_change_24h"),
                "percent_change_7d": q.get("percent_change_7d"),
                "market_cap": q.get("market_cap"),
                "circulating_supply": item.get("circulating_supply"),
                "last_updated": q.get("last_updated"),
            })
        return coins

    def get_trending_gainers_losers(
        self,
        limit: int = 5,
        convert: str = "USD",
    ) -> Optional[Dict[str, List[Dict[str, Any]]]]:
        """
        Get top gainers and losers in the market.

        Args:
            limit: Number of top items per category
            convert: Target currency

        Returns:
            Dict with 'top_gainers' and 'top_losers' lists
        """
        # Fetch top 100 listings to accurately compute gainers & losers
        listings = self.get_latest_listings(limit=100, convert=convert)
        if not listings:
            return None

        # Filter out items with missing 24h changes
        valid = [c for c in listings if c.get("percent_change_24h") is not None]
        gainers = sorted(valid, key=lambda x: x["percent_change_24h"], reverse=True)[:limit]
        losers = sorted(valid, key=lambda x: x["percent_change_24h"])[:limit]

        return {
            "top_gainers": gainers,
            "top_losers": losers,
        }

    def get_crypto_map(
        self,
        symbols: Optional[List[str]] = None,
        limit: int = 100,
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Returns a mapping of CoinMarketCap IDs, names, symbols, and token contracts.

        Args:
            symbols: Optional list of symbols to filter (e.g. ['BTC', 'ETH'])
            limit: Number of results to return
        """
        endpoint = "/cryptocurrency/map"
        params: Dict[str, Any] = {"limit": limit}
        if symbols:
            params["symbol"] = ",".join(s.strip().upper() for s in symbols)

        res = self._get(endpoint, params)
        if not res or "data" not in res:
            return None
        return res.get("data", [])


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

    cmc = CoinMarketCapFeed()
    print("\n" + "=" * 60)
    print("COINMARKETCAP FEED TEST")
    print("=" * 60)
    print(f"API Configured: {cmc.is_configured}")

    if cmc.is_configured:
        print("\nFetching Quotes for Core Universe (BTC, ETH, CRO, SOL, AVAX, ARB, OP)...")
        quotes = cmc.get_quotes(["BTC", "ETH", "CRO", "SOL", "AVAX", "ARB", "OP"])
        if quotes:
            for sym, q in quotes.items():
                print(f"  {sym:5s}: ${q.get('price', 0):,.2f} | 24h: {q.get('percent_change_24h', 0):+.2f}% | Rank: #{q.get('cmc_rank')}")

        print("\nFetching Global Metrics...")
        global_data = cmc.get_global_metrics()
        if global_data:
            print(f"  Total Market Cap: ${global_data.get('total_market_cap', 0):,.0f}")
            print(f"  BTC Dominance   : {global_data.get('btc_dominance', 0):.2f}%")
            print(f"  ETH Dominance   : {global_data.get('eth_dominance', 0):.2f}%")
            print(f"  DeFi 24h Volume : ${global_data.get('defi_volume_24h', 0):,.0f}")
    else:
        print("\nNote: CMC_API_KEY not configured in environment.")
        print("To configure, add CMC_API_KEY or COINMARKETCAP_API_KEY to your .env file.")
    print("=" * 60)
