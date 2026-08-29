"""
coingecko_feed.py
=================
CoinGecko API integration for market data, prices, and on-chain metrics.
Includes support for both free and pro API tiers.
"""

import os
import logging
import asyncio
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
import requests
import json

log = logging.getLogger("CoinGeckoFeed")


class CoinGeckoFeed:
    """
    Fetches market data, prices, and on-chain metrics from CoinGecko.
    Supports free API (rate limited) and pro API (higher limits).
    """

    def __init__(self, api_key: str = None, use_demo: bool = False):
        """
        Initialize CoinGecko feed.

        Args:
            api_key: Optional pro API key
            use_demo: Use demo/free tier (default)
        """
        raw_key = api_key or os.getenv("COINGECKO_API_KEY", "")
        # Treat placeholder strings as empty so it uses free demo tier
        if raw_key and any(raw_key.lower().startswith(p) for p in ("your_", "placeholder", "xxx")):
            raw_key = ""
        self.api_key = raw_key
        self.use_demo = use_demo or not self.api_key
        self.base_url = "https://api.coingecko.com/api/v3" if self.use_demo else "https://pro-api.coingecko.com/api/v3"
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "AiTradingAgent/1.0",
            "Accept": "application/json",
        })
        self.cache = {}
        self.cache_ttl = 60  # seconds

        log.info(f"CoinGecko initialized | Tier: {'Pro' if self.api_key else 'Free'} | URL: {self.base_url}")

    def _add_auth(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Add API key to request parameters if available."""
        if self.api_key:
            params["x_cg_pro_api_key"] = self.api_key
        return params

    def _cache_key(self, endpoint: str, params: Dict) -> str:
        """Generate cache key from endpoint and parameters."""
        param_str = json.dumps(params, sort_keys=True)
        return f"{endpoint}:{param_str}"

    def _get_cached(self, key: str) -> Optional[Any]:
        """Get cached data if not expired."""
        if key in self.cache:
            data, timestamp = self.cache[key]
            if datetime.now() < timestamp + timedelta(seconds=self.cache_ttl):
                return data
            else:
                del self.cache[key]
        return None

    def _set_cache(self, key: str, data: Any) -> None:
        """Set cache with timestamp."""
        self.cache[key] = (data, datetime.now())

    def get_price(self, token_id: str, vs_currency: str = "usd") -> Optional[Dict[str, float]]:
        """
        Get current price for a token.

        Args:
            token_id: CoinGecko token ID (e.g., "bitcoin", "ethereum")
            vs_currency: Currency (default: "usd")

        Returns:
            Dict with price, market_cap, 24h_volume, etc.
        """
        endpoint = "/simple/price"
        params = {
            "ids": token_id,
            "vs_currencies": vs_currency,
            "include_market_cap": "true",
            "include_24hr_vol": "true",
            "include_24hr_change": "true",
            "include_last_updated_at": "true",
        }

        cache_key = self._cache_key(endpoint, params)
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        try:
            params = self._add_auth(params)
            response = self.session.get(f"{self.base_url}{endpoint}", params=params, timeout=10)
            response.raise_for_status()

            data = response.json()
            self._set_cache(cache_key, data)
            return data
        except Exception as e:
            log.error(f"Error fetching price for {token_id}: {e}")
            return None

    def get_market_data(self, token_id: str) -> Optional[Dict[str, Any]]:
        """
        Get comprehensive market data for a token.

        Args:
            token_id: CoinGecko token ID

        Returns:
            Dict with market data including rank, ATH, ATL, etc.
        """
        endpoint = "/coins/{}"
        params = {
            "localization": "false",
            "tickers": "false",
            "market_data": "true",
            "community_data": "false",
            "developer_data": "false",
        }

        cache_key = self._cache_key(endpoint, params)
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        try:
            params = self._add_auth(params)
            response = self.session.get(f"{self.base_url}{endpoint.format(token_id)}", params=params, timeout=10)
            response.raise_for_status()

            data = response.json()
            self._set_cache(cache_key, data)
            return data
        except Exception as e:
            log.error(f"Error fetching market data for {token_id}: {e}")
            return None

    def get_trending(self, limit: int = 10) -> Optional[List[Dict[str, Any]]]:
        """
        Get trending tokens.

        Args:
            limit: Number of trending tokens to return

        Returns:
            List of trending tokens with data
        """
        endpoint = "/search/trending"
        params = {"limit": limit}

        cache_key = self._cache_key(endpoint, params)
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        try:
            params = self._add_auth(params)
            response = self.session.get(f"{self.base_url}{endpoint}", params=params, timeout=10)
            response.raise_for_status()

            data = response.json()
            self._set_cache(cache_key, data)
            return data.get("coins", [])
        except Exception as e:
            log.error(f"Error fetching trending tokens: {e}")
            return None

    def get_global_data(self) -> Optional[Dict[str, Any]]:
        """
        Get global market data (market cap, volume, BTC dominance, etc.).

        Returns:
            Dict with global market metrics
        """
        endpoint = "/global"
        params = {}

        cache_key = self._cache_key(endpoint, params)
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        try:
            params = self._add_auth(params)
            response = self.session.get(f"{self.base_url}{endpoint}", params=params, timeout=10)
            response.raise_for_status()

            data = response.json()
            self._set_cache(cache_key, data)
            return data.get("data", {})
        except Exception as e:
            log.error(f"Error fetching global data: {e}")
            return None

    def get_historical_data(self, token_id: str, days: int = 30) -> Optional[List[List[float]]]:
        """
        Get historical price data.

        Args:
            token_id: CoinGecko token ID
            days: Number of days of history (1-10000)

        Returns:
            List of [timestamp, price] pairs
        """
        endpoint = f"/coins/{token_id}/market_chart"
        params = {
            "vs_currency": "usd",
            "days": days,
            "interval": "daily",
        }

        cache_key = self._cache_key(endpoint, params)
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        try:
            params = self._add_auth(params)
            response = self.session.get(f"{self.base_url}{endpoint}", params=params, timeout=10)
            response.raise_for_status()

            data = response.json()
            prices = data.get("prices", [])
            self._set_cache(cache_key, prices)
            return prices
        except Exception as e:
            log.error(f"Error fetching historical data for {token_id}: {e}")
            return None

    def get_exchanges(self, limit: int = 10) -> Optional[List[Dict[str, Any]]]:
        """
        Get list of exchanges with volume data.

        Args:
            limit: Number of exchanges

        Returns:
            List of exchanges with data
        """
        endpoint = "/exchanges"
        params = {
            "per_page": limit,
            "order": "trade_volume_24h_btc_desc",
        }

        cache_key = self._cache_key(endpoint, params)
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        try:
            params = self._add_auth(params)
            response = self.session.get(f"{self.base_url}{endpoint}", params=params, timeout=10)
            response.raise_for_status()

            data = response.json()
            self._set_cache(cache_key, data)
            return data
        except Exception as e:
            log.error(f"Error fetching exchanges: {e}")
            return None

    def get_category(self, category_id: str) -> Optional[Dict[str, Any]]:
        """
        Get data for a token category (e.g., "defi", "nft", "gaming").

        Args:
            category_id: Category ID

        Returns:
            Category data with top tokens
        """
        endpoint = f"/coins/categories/{category_id}"
        params = {}

        cache_key = self._cache_key(endpoint, params)
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        try:
            params = self._add_auth(params)
            response = self.session.get(f"{self.base_url}{endpoint}", params=params, timeout=10)
            response.raise_for_status()

            data = response.json()
            self._set_cache(cache_key, data)
            return data
        except Exception as e:
            log.error(f"Error fetching category {category_id}: {e}")
            return None

    def get_supported_vs_currencies(self) -> Optional[List[str]]:
        """
        Get list of supported vs currencies.

        Returns:
            List of currency codes
        """
        endpoint = "/simple/supported_vs_currencies"
        params = {}

        try:
            params = self._add_auth(params)
            response = self.session.get(f"{self.base_url}{endpoint}", params=params, timeout=10)
            response.raise_for_status()

            return response.json()
        except Exception as e:
            log.error(f"Error fetching supported currencies: {e}")
            return None

    def get_token_ids_by_symbol(self, symbol: str) -> Optional[List[Dict[str, str]]]:
        """
        Search for token IDs by symbol.

        Args:
            symbol: Token symbol (e.g., "btc", "eth")

        Returns:
            List of matching tokens
        """
        endpoint = "/search"
        params = {"query": symbol}

        try:
            params = self._add_auth(params)
            response = self.session.get(f"{self.base_url}{endpoint}", params=params, timeout=10)
            response.raise_for_status()

            data = response.json()
            coins = data.get("coins", [])
            return [{"id": c["id"], "name": c["name"], "symbol": c["symbol"]} for c in coins[:5]]
        except Exception as e:
            log.error(f"Error searching for token {symbol}: {e}")
            return None

    def get_defi_data(self) -> Optional[Dict[str, Any]]:
        """
        Get DeFi protocol data.

        Returns:
            Dict with DeFi metrics
        """
        endpoint = "/global/decentralized_finance_defi"
        params = {}

        cache_key = self._cache_key(endpoint, params)
        cached = self._get_cached(cache_key)
        if cached:
            return cached

        try:
            params = self._add_auth(params)
            response = self.session.get(f"{self.base_url}{endpoint}", params=params, timeout=10)
            response.raise_for_status()

            data = response.json()
            self._set_cache(cache_key, data)
            return data.get("data", {})
        except Exception as e:
            log.error(f"Error fetching DeFi data: {e}")
            return None


if __name__ == "__main__":
    # Example usage
    cg = CoinGeckoFeed()

    # Get Bitcoin price
    btc_price = cg.get_price("bitcoin")
    print("BTC Price:", btc_price)

    # Get trending tokens
    trending = cg.get_trending(5)
    print("\nTrending Tokens:")
    for token in trending:
        print(f"  {token['item']['name']}: {token['item']['market_cap_rank']}")

    # Get global data
    global_data = cg.get_global_data()
    if global_data:
        print(f"\nGlobal Market Cap: ${global_data.get('total_market_cap', {}).get('usd', 0):,.0f}")
        print(f"BTC Dominance: {global_data.get('btc_market_cap_percentage', {}).get('btc', 0):.2f}%")
