from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from core.data_schema import Candle, DataSource

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared HTTP session factory
# ---------------------------------------------------------------------------

def _make_session(
    retries: int = 3,
    backoff_factor: float = 1.0,
    timeout: int = 10,
) -> requests.Session:
    """
    Returns a Session with:
    - Automatic retries with exponential backoff on 429 / 5xx
    - A default timeout (applied per-request via the session)
    """
    session = requests.Session()
    retry = Retry(
        total            = retries,
        backoff_factor   = backoff_factor,
        status_forcelist = {429, 500, 502, 503, 504},
        allowed_methods  = {"GET"},
        raise_on_status  = False,   # we handle status ourselves for better errors
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://",  adapter)
    session._default_timeout = timeout  # checked in _get() below
    return session


# ---------------------------------------------------------------------------
# Base client
# ---------------------------------------------------------------------------

class _BaseClient:
    def __init__(self, base_url: str, timeout: int = 10) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout  = timeout
        self._session = _make_session(timeout=timeout)

    def _get(self, path: str, **kwargs) -> Any:
        url = f"{self.base_url}/{path.lstrip('/')}"
        kwargs.setdefault("timeout", self.timeout)
        try:
            resp = self._session.get(url, **kwargs)
        except requests.exceptions.ConnectionError as exc:
            raise MarketDataError(f"Connection failed for {url}: {exc}") from exc
        except requests.exceptions.Timeout as exc:
            raise MarketDataError(f"Request timed out for {url}: {exc}") from exc

        if not resp.ok:
            raise MarketDataError(
                f"HTTP {resp.status_code} from {url}: {resp.text[:200]}"
            )
        return resp.json()


# ---------------------------------------------------------------------------
# CoinGecko
# ---------------------------------------------------------------------------

class CoinGeckoClient(_BaseClient):
    """
    Wraps the CoinGecko public API.

    Note: the /ohlc endpoint expects a CoinGecko coin ID (e.g. "bitcoin"),
    not a ticker symbol (e.g. "BTC"). Maintain a symbol→id map in your config.
    """

    # CoinGecko free tier: ~10–30 req/min.  We space calls conservatively.
    _MIN_INTERVAL_S = 2.0

    def __init__(
        self,
        base_url: str = "https://api.coingecko.com/api/v3",
        timeout: int = 10,
    ) -> None:
        super().__init__(base_url, timeout)
        self._last_call: float = 0.0

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_call
        wait    = self._MIN_INTERVAL_S - elapsed
        if wait > 0:
            logger.debug("CoinGecko throttle: sleeping %.2fs", wait)
            time.sleep(wait)
        self._last_call = time.monotonic()

    def get_ohlc(
        self,
        coin_id     : str,
        vs_currency : str = "usd",
        days        : int = 90,
    ) -> List[Candle]:
        """
        Fetch OHLC candles and return them as validated Candle objects.

        Args:
            coin_id:     CoinGecko coin ID, e.g. "bitcoin".
            vs_currency: Quote currency, e.g. "usd".
            days:        Lookback window.  CoinGecko rounds to 1/7/14/30/90/180/365/max.

        Returns:
            List of Candle objects sorted by timestamp ascending.
        """
        self._throttle()
        raw: List[List[float]] = self._get(
            f"/coins/{coin_id}/ohlc",
            params={"vs_currency": vs_currency, "days": days},
        )

        candles: List[Candle] = []
        for row in raw:
            # CoinGecko format: [timestamp_ms, open, high, low, close]
            if len(row) != 5:
                logger.warning("Skipping malformed CoinGecko row: %s", row)
                continue
            ts_ms, o, h, l, c = row
            try:
                candle = Candle(
                    timestamp = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc),
                    symbol    = coin_id.upper(),
                    open      = o,
                    high      = h,
                    low       = l,
                    close     = c,
                    volume    = 0.0,   # CoinGecko OHLC endpoint omits volume
                    source    = DataSource.UNKNOWN,
                )
                candles.append(candle)
            except ValueError as exc:
                logger.warning("Skipping invalid candle from CoinGecko: %s", exc)

        logger.info(
            "CoinGecko: fetched %d candles for %s (%s days).",
            len(candles), coin_id, days,
        )
        return candles


# ---------------------------------------------------------------------------
# CoinMarketCap
# ---------------------------------------------------------------------------

class CoinMarketCapClient(_BaseClient):
    """
    Wraps the CoinMarketCap Pro API.
    Requires a valid API key — fails loudly on construction if missing.
    """

    def __init__(
        self,
        api_key  : str,
        base_url : str = "https://pro-api.coinmarketcap.com/v1",
        timeout  : int = 10,
    ) -> None:
        if not api_key:
            raise ValueError(
                "CoinMarketCapClient requires an api_key. "
                "Set APP_CMC_API_KEY in your environment."
            )
        super().__init__(base_url, timeout)
        self._api_key = api_key

    def _headers(self) -> Dict[str, str]:
        return {
            "X-CMC_PRO_API_KEY": self._api_key,
            "Accept"           : "application/json",
        }

    def quotes_latest(self, symbol: str) -> Dict[str, Any]:
        """
        Fetch the latest quote for one or more comma-separated symbols,
        e.g. "BTC" or "BTC,ETH".

        Returns the raw CMC response dict (data + status envelope).
        """
        raw = self._get(
            "/cryptocurrency/quotes/latest",
            params  = {"symbol": symbol.upper()},
            headers = self._headers(),
        )
        # CMC wraps errors in a 200 response with status.error_code != 0
        error_code = raw.get("status", {}).get("error_code", 0)
        if error_code != 0:
            error_msg = raw["status"].get("error_message", "Unknown CMC error")
            raise MarketDataError(
                f"CoinMarketCap API error {error_code}: {error_msg}"
            )

        logger.info("CoinMarketCap: fetched quote for %s.", symbol)
        return raw["data"]


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------

class MarketDataError(RuntimeError):
    """Raised when a market data fetch fails for any reason."""
