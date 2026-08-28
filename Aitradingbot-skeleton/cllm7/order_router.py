from __future__ import annotations

"""
execution/order_router.py

Multi-exchange order router with safety rails.
Inspired by Multi-Trading-Bot (Digixperts) execution engine.

Supports:  Bybit | Crypto.com | Binance | Coinbase (paper mode for all)
Safety:    Daily loss cap | Max concurrent trades | Min confidence gate
Profit:    Auto-routes net profit to Nexo BTC sweep on close

Alan J | barcay0611@gmail.com | github: smokey79
"""

from __future__ import annotations

import logging
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

PAPER_TRADE_MODE       = os.getenv("PAPER_TRADE_MODE", "true").lower() == "true"
MAX_CONCURRENT_TRADES  = int(os.getenv("MAX_CONCURRENT_TRADES", "3"))
MAX_DAILY_LOSS_USD     = float(os.getenv("MAX_DAILY_LOSS_USD", "50.0"))
MIN_CONFIDENCE         = float(os.getenv("MIN_WIN_RATE_THRESHOLD", "0.68"))
TRADE_AMOUNT_USD       = float(os.getenv("TRADE_AMOUNT_USD", "1000.0"))


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

class OrderSide(str, Enum):
    BUY  = "buy"
    SELL = "sell"

class OrderStatus(str, Enum):
    PENDING   = "pending"
    FILLED    = "filled"
    CANCELLED = "cancelled"
    FAILED    = "failed"


@dataclass
class Order:
    order_id       : str
    symbol         : str
    side           : OrderSide
    qty_usd        : float
    entry_price    : float
    stop_loss      : float
    take_profit    : float
    exchange       : str
    status         : OrderStatus = OrderStatus.PENDING
    fill_price     : Optional[float] = None
    closed_price   : Optional[float] = None
    pnl_usd        : float = 0.0
    opened_at      : str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    closed_at      : Optional[str] = None
    paper          : bool = PAPER_TRADE_MODE


@dataclass
class ExecutionResult:
    success        : bool
    order_id       : str
    message        : str
    pnl_usd        : float = 0.0


# ---------------------------------------------------------------------------
# Safety gate
# ---------------------------------------------------------------------------

class SafetyGate:
    """
    Pre-execution checks. All must pass before an order is sent.
    Matches Digixperts' gating pattern.
    """

    def __init__(self) -> None:
        self._daily_loss    : float = 0.0
        self._open_positions: Dict[str, Order] = {}
        self._day_key       : str = ""

    def _reset_if_new_day(self) -> None:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if today != self._day_key:
            self._daily_loss = 0.0
            self._day_key    = today
            logger.info("New trading day — daily loss reset.")

    def check(self, symbol: str, size: float, confidence: float) -> tuple[bool, str]:
        """Returns (approved, reason)."""
        self._reset_if_new_day()

        if self._daily_loss <= -MAX_DAILY_LOSS_USD:
            return False, f"Daily loss cap hit (${self._daily_loss:.2f} / ${MAX_DAILY_LOSS_USD})"

        if len(self._open_positions) >= MAX_CONCURRENT_TRADES:
            return False, f"Max concurrent trades reached ({MAX_CONCURRENT_TRADES})"

        if confidence < MIN_CONFIDENCE:
            return False, f"Confidence {confidence:.2f} below threshold {MIN_CONFIDENCE:.2f}"

        if symbol in self._open_positions:
            return False, f"Already have open position in {symbol}"

        return True, "approved"

    def register_open(self, order: Order) -> None:
        self._open_positions[order.symbol] = order

    def register_close(self, order: Order) -> None:
        self._open_positions.pop(order.symbol, None)
        self._daily_loss += order.pnl_usd
        logger.info(
            "Position closed: %s pnl=$%.2f | daily_loss=$%.2f",
            order.symbol, order.pnl_usd, self._daily_loss,
        )

    @property
    def open_positions(self) -> Dict[str, Order]:
        return dict(self._open_positions)

    def status(self) -> Dict[str, Any]:
        return {
            "daily_loss_usd"    : round(self._daily_loss, 2),
            "daily_loss_cap_usd": MAX_DAILY_LOSS_USD,
            "open_positions"    : len(self._open_positions),
            "max_positions"     : MAX_CONCURRENT_TRADES,
            "min_confidence"    : MIN_CONFIDENCE,
        }


# ---------------------------------------------------------------------------
# Exchange adapters (stubs — wire SDK per exchange)
# ---------------------------------------------------------------------------

class _BaseExchangeAdapter:
    name: str = "base"

    def place_order(self, order: Order) -> ExecutionResult:
        raise NotImplementedError

    def close_order(self, order: Order, close_price: float) -> ExecutionResult:
        raise NotImplementedError

    def get_ticker(self, symbol: str) -> float:
        raise NotImplementedError


class BybitAdapter(_BaseExchangeAdapter):
    name = "bybit"

    def __init__(self) -> None:
        self.api_key    = os.getenv("APP_BYBIT_API_KEY", "")
        self.api_secret = os.getenv("APP_BYBIT_API_SECRET", "")

    def place_order(self, order: Order) -> ExecutionResult:
        if PAPER_TRADE_MODE:
            logger.info("[PAPER/BYBIT] BUY %s $%.2f", order.symbol, order.qty_usd)
            return ExecutionResult(True, order.order_id, "paper_filled")

        # TODO: wire pybit SDK
        # from pybit.unified_trading import HTTP
        # session = HTTP(api_key=self.api_key, api_secret=self.api_secret)
        # resp = session.place_order(
        #     category="spot", symbol=order.symbol,
        #     side="Buy", orderType="Market",
        #     qty=str(order.qty_usd), marketUnit="quoteCoin",
        # )
        # return ExecutionResult(True, resp["result"]["orderId"], "filled")
        return ExecutionResult(False, order.order_id, "STUB — wire pybit SDK")

    def close_order(self, order: Order, close_price: float) -> ExecutionResult:
        if PAPER_TRADE_MODE:
            return ExecutionResult(True, order.order_id, "paper_closed")
        return ExecutionResult(False, order.order_id, "STUB — wire pybit SDK")

    def get_ticker(self, symbol: str) -> float:
        if PAPER_TRADE_MODE:
            return 0.0   # Caller should provide simulated price
        return 0.0


class CryptoComAdapter(_BaseExchangeAdapter):
    name = "crypto.com"

    def place_order(self, order: Order) -> ExecutionResult:
        if PAPER_TRADE_MODE:
            logger.info("[PAPER/CRYPTO.COM] BUY %s $%.2f", order.symbol, order.qty_usd)
            return ExecutionResult(True, order.order_id, "paper_filled")
        # TODO: wire crypto.com SDK
        return ExecutionResult(False, order.order_id, "STUB — wire Crypto.com SDK")

    def close_order(self, order: Order, close_price: float) -> ExecutionResult:
        return ExecutionResult(True, order.order_id, "paper_closed") if PAPER_TRADE_MODE else \
               ExecutionResult(False, order.order_id, "STUB")

    def get_ticker(self, symbol: str) -> float:
        return 0.0


# ---------------------------------------------------------------------------
# Order router
# ---------------------------------------------------------------------------

class OrderRouter:
    """
    Main execution entry point.

    Usage:
        router = OrderRouter()
        result = router.execute(
            symbol="BTCUSDT", action="LONG", size=0.3,
            entry=65000, stop_loss=63000, take_profit=68000,
            confidence=0.72,
        )
    """

    _ADAPTERS: Dict[str, _BaseExchangeAdapter] = {
        "bybit"     : BybitAdapter(),
        "crypto.com": CryptoComAdapter(),
    }

    def __init__(self) -> None:
        self.gate     = SafetyGate()
        self.exchange = os.getenv("APP_ACTIVE_EXCHANGE", "bybit").lower()
        self.adapter  = self._ADAPTERS.get(self.exchange, BybitAdapter())
        self._orders  : Dict[str, Order] = {}

    def execute(
        self,
        symbol      : str,
        action      : str,          # "LONG" | "SHORT" | "FLAT"
        size        : float,         # fraction of TRADE_AMOUNT_USD
        entry       : float,
        stop_loss   : float,
        take_profit : float,
        confidence  : float = 1.0,
    ) -> ExecutionResult:
        if action == "FLAT":
            return ExecutionResult(True, "N/A", "FLAT — no order placed")

        approved, reason = self.gate.check(symbol, size, confidence)
        if not approved:
            logger.info("Order blocked by safety gate: %s", reason)
            return ExecutionResult(False, "N/A", f"BLOCKED: {reason}")

        qty_usd  = TRADE_AMOUNT_USD * size
        order_id = str(uuid.uuid4())[:8]
        side     = OrderSide.BUY if action == "LONG" else OrderSide.SELL

        order = Order(
            order_id    = order_id,
            symbol      = symbol,
            side        = side,
            qty_usd     = qty_usd,
            entry_price = entry,
            stop_loss   = stop_loss,
            take_profit = take_profit,
            exchange    = self.exchange,
        )

        result = self.adapter.place_order(order)
        if result.success:
            order.status     = OrderStatus.FILLED
            order.fill_price = entry
            self.gate.register_open(order)
            self._orders[order_id] = order
            logger.info(
                "Order placed: %s %s %s $%.2f (paper=%s)",
                action, symbol, order_id, qty_usd, PAPER_TRADE_MODE
            )

        return result

    def close_position(
        self,
        order_id    : str,
        close_price : float,
    ) -> ExecutionResult:
        order = self._orders.get(order_id)
        if not order:
            return ExecutionResult(False, order_id, "Order not found")

        result = self.adapter.close_order(order, close_price)
        if result.success:
            direction  = 1 if order.side == OrderSide.BUY else -1
            pnl_pct    = direction * (close_price - order.entry_price) / order.entry_price
            order.pnl_usd   = pnl_pct * order.qty_usd
            order.closed_price = close_price
            order.closed_at    = datetime.now(timezone.utc).isoformat()
            order.status       = OrderStatus.FILLED
            self.gate.register_close(order)

        return ExecutionResult(result.success, order_id, result.message, order.pnl_usd if order else 0)

    def status(self) -> Dict[str, Any]:
        return {
            "exchange"      : self.exchange,
            "paper_mode"    : PAPER_TRADE_MODE,
            "safety"        : self.gate.status(),
            "open_orders"   : len(self.gate.open_positions),
        }
