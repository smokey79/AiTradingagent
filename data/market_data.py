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
# CCXT (exchange market data — public endpoints, no API key required)
# ---------------------------------------------------------------------------

class CCXTClient:
    """
    Wraps a CCXT exchange for live spot market data: tickers, OHLCV, order book.

    Public market-data endpoints only — no API key/secret needed and no
    orders are ever placed from here. Default exchange is Bitget (the
    project's chosen venue); pass exchange_id="binance" etc. to use another.
    """

    def __init__(self, exchange_id: str = "bitget", timeout: int = 10) -> None:
        import ccxt  # local import: keeps ccxt optional for callers that don't need it

        if not hasattr(ccxt, exchange_id):
            raise MarketDataError(f"Unknown CCXT exchange id: {exchange_id!r}")

        self.exchange_id = exchange_id
        exchange_class = getattr(ccxt, exchange_id)
        self.exchange = exchange_class({
            "enableRateLimit": True,
            "timeout": timeout * 1000,  # ccxt wants milliseconds
        })
        self._source = DataSource(exchange_id) if exchange_id in DataSource._value2member_map_ else DataSource.UNKNOWN

    @staticmethod
    def normalize_pair(symbol: str) -> str:
        """
        Accepts either "BTC/USDT" or "BTCUSDT" and returns CCXT's "BASE/QUOTE" form.
        Assumes a 4-char quote (USDT/USDC) unless the symbol already has a slash.
        """
        if "/" in symbol:
            return symbol.upper()
        symbol = symbol.upper()
        if symbol.endswith("USDT") or symbol.endswith("USDC"):
            return f"{symbol[:-4]}/{symbol[-4:]}"
        # Fall back to a 3-char quote guess (e.g. BTCUSD)
        return f"{symbol[:-3]}/{symbol[-3:]}"

    def get_ticker(self, symbol: str) -> Dict[str, Any]:
        """Current price + 24h stats for one pair."""
        pair = self.normalize_pair(symbol)
        try:
            t = self.exchange.fetch_ticker(pair)
        except Exception as exc:
            raise MarketDataError(f"{self.exchange_id} ticker fetch failed for {pair}: {exc}") from exc
        return {
            "symbol":     symbol,
            "pair":       pair,
            "price":      t.get("last"),
            "change_24h": t.get("percentage"),
            "volume_24h": t.get("quoteVolume"),
            "high_24h":   t.get("high"),
            "low_24h":    t.get("low"),
            "timestamp":  datetime.now(timezone.utc).isoformat(),
        }

    def get_latest_candle(self, symbol: str, timeframe: str = "1h") -> Optional[Candle]:
        """Most recent completed OHLCV candle as a validated Candle object."""
        pair = self.normalize_pair(symbol)
        try:
            raw = self.exchange.fetch_ohlcv(pair, timeframe=timeframe, limit=1)
        except Exception as exc:
            raise MarketDataError(f"{self.exchange_id} OHLCV fetch failed for {pair}: {exc}") from exc

        if not raw:
            return None
        ts, o, h, l, c, v = raw[-1]
        try:
            return Candle(
                timestamp=datetime.fromtimestamp(ts / 1000, tz=timezone.utc),
                symbol=symbol,
                open=float(o), high=float(h), low=float(l), close=float(c),
                volume=float(v or 0.0),
                source=self._source,
            )
        except ValueError as exc:
            logger.warning("Skipping invalid %s candle from %s: %s", symbol, self.exchange_id, exc)
            return None

    def get_ohlcv_candles(self, symbol: str, timeframe: str = "1h", limit: int = 100) -> List[Candle]:
        """A run of recent OHLCV candles, oldest first — for backtesting/indicators."""
        pair = self.normalize_pair(symbol)
        try:
            raw = self.exchange.fetch_ohlcv(pair, timeframe=timeframe, limit=limit)
        except Exception as exc:
            raise MarketDataError(f"{self.exchange_id} OHLCV fetch failed for {pair}: {exc}") from exc

        candles: List[Candle] = []
        for ts, o, h, l, c, v in raw:
            try:
                candles.append(Candle(
                    timestamp=datetime.fromtimestamp(ts / 1000, tz=timezone.utc),
                    symbol=symbol,
                    open=float(o), high=float(h), low=float(l), close=float(c),
                    volume=float(v or 0.0),
                    source=self._source,
                ))
            except ValueError as exc:
                logger.warning("Skipping invalid %s candle from %s: %s", symbol, self.exchange_id, exc)
        return candles

    def get_order_book(self, symbol: str, depth: int = 10) -> Dict[str, Any]:
        """Top-N bids/asks — useful for liquidity/slippage checks before a paper fill."""
        pair = self.normalize_pair(symbol)
        try:
            ob = self.exchange.fetch_order_book(pair, limit=depth)
        except Exception as exc:
            raise MarketDataError(f"{self.exchange_id} order book fetch failed for {pair}: {exc}") from exc
        best_bid = ob["bids"][0][0] if ob.get("bids") else None
        best_ask = ob["asks"][0][0] if ob.get("asks") else None
        spread_pct = ((best_ask - best_bid) / best_bid * 100) if best_bid and best_ask else None
        return {
            "symbol": symbol, "pair": pair,
            "best_bid": best_bid, "best_ask": best_ask,
            "spread_pct": round(spread_pct, 4) if spread_pct is not None else None,
            "bids": ob.get("bids", [])[:depth],
            "asks": ob.get("asks", [])[:depth],
        }


# ---------------------------------------------------------------------------
# Combined feed: CCXT primary, CoinGecko fallback
# ---------------------------------------------------------------------------

# CCXT pair (BASE only) -> CoinGecko coin id, for the fallback path.
_COINGECKO_ID_MAP = {
    "BTC": "bitcoin", "ETH": "ethereum", "CRO": "crypto-com-chain",
    "SOL": "solana", "AVAX": "avalanche-2", "ARB": "arbitrum",
    "OP": "optimism", "MATIC": "matic-network", "LINK": "chainlink",
    "UNI": "uniswap", "AAVE": "aave", "BNB": "binancecoin",
}

_ccxt_client_cache: Dict[str, "CCXTClient"] = {}


def get_latest_candle(
    symbol: str,
    exchange_id: str = "bitget",
    timeframe: str = "1h",
) -> Optional[Candle]:
    """
    Live price for `symbol` (e.g. "BTCUSDT" or "BTC/USDT"): tries the given
    CCXT exchange first (default Bitget, no API key needed for market data),
    then falls back to CoinGecko. Returns None if both sources fail — the
    caller decides whether that means "use a placeholder" or "skip this cycle".
    """
    # 1) CCXT primary
    try:
        client = _ccxt_client_cache.get(exchange_id)
        if client is None:
            client = CCXTClient(exchange_id=exchange_id)
            _ccxt_client_cache[exchange_id] = client
        candle = client.get_latest_candle(symbol, timeframe=timeframe)
        if candle is not None:
            return candle
    except Exception as exc:
        logger.debug("CCXT (%s) fetch failed for %s: %s", exchange_id, symbol, exc)

    # 2) CoinGecko fallback
    try:
        sym_upper = symbol.upper()
        if "/" in sym_upper:
            base = sym_upper.split("/")[0]
        elif sym_upper.endswith("USDT") or sym_upper.endswith("USDC"):
            base = sym_upper[:-4]
        else:
            base = sym_upper
        coin_id = _COINGECKO_ID_MAP.get(base)
        if coin_id:
            cg = CoinGeckoClient()
            candles = cg.get_ohlc(coin_id, days=1)
            if candles:
                latest = candles[-1]
                latest.symbol = symbol
                latest.source = DataSource.COINGECKO
                return latest
    except Exception as exc:
        logger.debug("CoinGecko fetch failed for %s: %s", symbol, exc)

    return None


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
