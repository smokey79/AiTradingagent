from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Optional


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class DataSource(str, Enum):
    """Known candle data providers. Extend as needed."""
    BINANCE    = "binance"
    COINBASE   = "coinbase"
    CRYPTO_COM = "crypto.com"
    BYBIT      = "bybit"
    BACKTEST   = "backtest"   # synthetic / replay data
    UNKNOWN    = "unknown"


# ---------------------------------------------------------------------------
# Core dataclass
# ---------------------------------------------------------------------------

@dataclass
class Candle:
    """
    OHLCV candle for a single symbol and time interval.

    All prices are in the quote currency (e.g. USD).
    `timestamp` must be timezone-aware; prefer UTC.
    """

    timestamp : datetime
    symbol    : str
    open      : float
    high      : float
    low       : float
    close     : float
    volume    : float
    source    : DataSource

    # Optional enrichment — not required for a valid candle
    vwap      : Optional[float] = field(default=None)
    trades    : Optional[int]   = field(default=None)

    def __post_init__(self) -> None:
        # Coerce string → enum so callers can pass either
        if isinstance(self.source, str):
            self.source = DataSource(self.source.lower())
        # Enforce UTC-awareness
        if self.timestamp.tzinfo is None:
            raise ValueError(
                "Candle.timestamp must be timezone-aware. "
                "Use datetime(..., tzinfo=timezone.utc) or .replace(tzinfo=timezone.utc)."
            )
        self.validate()

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def validate(self) -> None:
        """Raise ValueError on any structural inconsistency."""
        self._validate_symbol()
        self._validate_prices()
        self._validate_ohlc_relationships()
        self._validate_volume()
        self._validate_optional_fields()

    def _validate_symbol(self) -> None:
        if not self.symbol or not self.symbol.strip():
            raise ValueError("Candle.symbol must be a non-empty string.")

    def _validate_prices(self) -> None:
        for name, value in (
            ("open",  self.open),
            ("high",  self.high),
            ("low",   self.low),
            ("close", self.close),
        ):
            if value <= 0:
                raise ValueError(
                    f"Candle.{name} must be > 0, got {value!r} for {self.symbol}."
                )

    def _validate_ohlc_relationships(self) -> None:
        # low ≤ high is the fundamental invariant
        if self.low > self.high:
            raise ValueError(
                f"low ({self.low}) > high ({self.high}) for {self.symbol}."
            )
        # open and close must both lie within [low, high]
        # Use >= / <= (not strict) so doji candles (open == high, etc.) are valid
        for name, value in (("open", self.open), ("close", self.close)):
            if not (self.low <= value <= self.high):
                raise ValueError(
                    f"Candle.{name} ({value}) outside [low={self.low}, high={self.high}] "
                    f"for {self.symbol}."
                )

    def _validate_volume(self) -> None:
        if self.volume < 0:
            raise ValueError(
                f"Candle.volume must be ≥ 0, got {self.volume!r} for {self.symbol}."
            )

    def _validate_optional_fields(self) -> None:
        if self.vwap is not None and self.vwap <= 0:
            raise ValueError(
                f"Candle.vwap must be > 0 when set, got {self.vwap!r}."
            )
        if self.trades is not None and self.trades < 0:
            raise ValueError(
                f"Candle.trades must be ≥ 0 when set, got {self.trades!r}."
            )

    # ------------------------------------------------------------------
    # Convenience properties
    # ------------------------------------------------------------------

    @property
    def body(self) -> float:
        """Absolute candle body size (|close - open|)."""
        return abs(self.close - self.open)

    @property
    def upper_wick(self) -> float:
        return self.high - max(self.open, self.close)

    @property
    def lower_wick(self) -> float:
        return min(self.open, self.close) - self.low

    @property
    def is_bullish(self) -> bool:
        return self.close >= self.open

    @property
    def is_doji(self, threshold: float = 1e-8) -> bool:
        """True when open ≈ close (body is negligible)."""
        return self.body < threshold

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["timestamp"] = self.timestamp.isoformat()
        d["source"]    = self.source.value
        return d

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Candle:
        """
        Deserialise from a plain dict (e.g. JSON payload or DataFrame row).
        Accepts both ISO-8601 strings and datetime objects for `timestamp`.
        """
        data = dict(data)  # don't mutate caller's dict
        ts = data["timestamp"]
        if isinstance(ts, str):
            data["timestamp"] = datetime.fromisoformat(ts)
        return cls(**data)

    # ------------------------------------------------------------------
    # Dunder helpers
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        return (
            f"Candle({self.symbol} @ {self.timestamp.isoformat()} | "
            f"O={self.open} H={self.high} L={self.low} C={self.close} "
            f"V={self.volume} src={self.source.value})"
        )
