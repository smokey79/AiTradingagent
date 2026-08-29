"""
trading_mode_controller.py
==========================
Controls trading mode: AUTOMATION (AI-driven) vs MANUAL (user-controlled)
Supports paper trading, sandbox, and live modes.
"""

import os
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime
from enum import Enum
import json

log = logging.getLogger("TradingModeController")


class TradeMode(Enum):
    """Trading modes"""
    AUTOMATION = "automation"  # AI-driven automatic trading
    MANUAL = "manual"          # User-controlled manual trading
    HYBRID = "hybrid"          # Both modes active (user can override AI)


class TradeStatus(Enum):
    """Trade status"""
    PENDING = "pending"
    EXECUTED = "executed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    FILLED = "filled"
    PARTIAL = "partial"


class TradingModeController:
    """
    Controls trading mode and trade execution.
    Supports automation, manual trading, and hybrid modes.
    """

    def __init__(
        self,
        mode: str = "manual",
        paper_trading: bool = True,
        max_trade_size: float = 100.0,
        require_confirmation: bool = False,
    ):
        """
        Initialize trading mode controller.

        Args:
            mode: "automation", "manual", or "hybrid"
            paper_trading: Use paper trading (no real money)
            max_trade_size: Maximum trade size in USD
            require_confirmation: Require manual confirmation for auto trades
        """
        normalized_mode = (mode or "manual").lower()
        if normalized_mode in ["paper", "simulation", "sim"]:
            self.mode = TradeMode.AUTOMATION
            paper_trading = True
        elif normalized_mode in ["live", "real", "auto"]:
            self.mode = TradeMode.AUTOMATION
        elif normalized_mode in ["hybrid"]:
            self.mode = TradeMode.HYBRID
        elif normalized_mode in ["manual"]:
            self.mode = TradeMode.MANUAL
        else:
            self.mode = TradeMode.AUTOMATION
        self.paper_trading = paper_trading
        self.max_trade_size = max_trade_size
        self.require_confirmation = require_confirmation
        self.is_active = False
        self.trades = []
        self.pending_confirmations = []

        log.info(
            f"Trading Mode Controller initialized | Mode: {self.mode.value} | "
            f"Paper: {paper_trading} | Max Size: ${max_trade_size}"
        )

    def start(self) -> bool:
        """Activate trading mode."""
        if self.paper_trading:
            log.warning("⚠️  PAPER TRADING MODE ACTIVE - NO REAL MONEY AT RISK")
        else:
            log.warning("⚠️  LIVE TRADING MODE ACTIVE - REAL MONEY AT RISK!")

        self.is_active = True
        log.info(f"✅ Trading activated | Mode: {self.mode.value}")
        return True

    def stop(self) -> bool:
        """Deactivate trading mode."""
        self.is_active = False
        log.info("⏹️  Trading deactivated")
        return True

    def toggle_mode(self, new_mode: str) -> bool:
        """Switch between automation/manual/hybrid."""
        try:
            self.mode = TradeMode(new_mode.lower())
            log.info(f"🔄 Mode switched to: {self.mode.value}")
            return True
        except ValueError:
            log.error(f"Invalid mode: {new_mode}")
            return False

    def execute_trade(
        self,
        symbol: str,
        action: str,
        amount: float,
        price: float = None,
        order_type: str = "market",
        metadata: Dict[str, Any] = None,
        source: str = "ai",
    ) -> Dict[str, Any]:
        """
        Execute a trade based on current mode.

        Args:
            symbol: Trading pair (e.g., "BTC/USDT")
            action: "buy" or "sell"
            amount: Quantity to trade
            price: Limit price (for limit orders)
            order_type: "market" or "limit"
            metadata: Additional data (confidence, reason, etc.)
            source: "ai" or "manual"

        Returns:
            Trade execution result
        """
        if not self.is_active:
            return {
                "status": "failed",
                "reason": "Trading not active",
                "timestamp": datetime.utcnow().isoformat(),
            }

        # Validate trade size
        trade_value = amount * (price or 0)
        if trade_value > self.max_trade_size:
            log.warning(f"Trade exceeds max size: ${trade_value} > ${self.max_trade_size}")
            return {
                "status": "failed",
                "reason": f"Trade size ${trade_value} exceeds limit ${self.max_trade_size}",
                "timestamp": datetime.utcnow().isoformat(),
            }

        # Handle based on mode
        if self.mode == TradeMode.AUTOMATION and source == "ai":
            if self.require_confirmation:
                return self._queue_for_confirmation(
                    symbol, action, amount, price, order_type, metadata
                )
            else:
                return self._execute_trade(symbol, action, amount, price, order_type, metadata)

        elif self.mode == TradeMode.MANUAL and source == "manual":
            return self._execute_trade(symbol, action, amount, price, order_type, metadata)

        elif self.mode == TradeMode.HYBRID:
            if source == "ai" and self.require_confirmation:
                return self._queue_for_confirmation(
                    symbol, action, amount, price, order_type, metadata
                )
            else:
                return self._execute_trade(symbol, action, amount, price, order_type, metadata)

        else:
            return {
                "status": "rejected",
                "reason": f"Mode mismatch: {self.mode.value} / Source: {source}",
                "timestamp": datetime.utcnow().isoformat(),
            }

    def _queue_for_confirmation(
        self,
        symbol: str,
        action: str,
        amount: float,
        price: float,
        order_type: str,
        metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Queue a trade for user confirmation."""
        confirmation_id = f"confirm_{len(self.pending_confirmations)}_{int(datetime.utcnow().timestamp())}"

        pending_trade = {
            "confirmation_id": confirmation_id,
            "symbol": symbol,
            "action": action,
            "amount": amount,
            "price": price,
            "order_type": order_type,
            "metadata": metadata,
            "status": "pending_confirmation",
            "created_at": datetime.utcnow().isoformat(),
        }

        self.pending_confirmations.append(pending_trade)

        log.info(f"🔔 Trade queued for confirmation | ID: {confirmation_id}")
        return {
            "status": "pending_confirmation",
            "confirmation_id": confirmation_id,
            "trade": pending_trade,
        }

    def _execute_trade(
        self,
        symbol: str,
        action: str,
        amount: float,
        price: float,
        order_type: str,
        metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Execute the actual trade."""
        trade_id = f"trade_{len(self.trades)}_{int(datetime.utcnow().timestamp())}"

        trade_record = {
            "trade_id": trade_id,
            "symbol": symbol,
            "action": action,
            "amount": amount,
            "price": price or 0,
            "order_type": order_type,
            "metadata": metadata or {},
            "status": "executed",
            "executed_at": datetime.utcnow().isoformat(),
        }

        self.trades.append(trade_record)

        emoji = "📈" if action.lower() == "buy" else "📉"
        log.info(
            f"{emoji} Trade executed | {action.upper()} {amount} {symbol} @ ${price or 'market'}"
        )

        if self.paper_trading:
            log.info("   (Paper trading - no real money)")

        return {
            "status": "executed",
            "trade_id": trade_id,
            "trade": trade_record,
        }

    def confirm_trade(self, confirmation_id: str) -> Dict[str, Any]:
        """Confirm and execute a pending trade."""
        pending = next(
            (t for t in self.pending_confirmations if t["confirmation_id"] == confirmation_id),
            None,
        )

        if not pending:
            return {"status": "failed", "reason": "Confirmation not found"}

        # Remove from pending
        self.pending_confirmations.remove(pending)

        # Execute
        return self._execute_trade(
            pending["symbol"],
            pending["action"],
            pending["amount"],
            pending["price"],
            pending["order_type"],
            pending["metadata"],
        )

    def reject_trade(self, confirmation_id: str) -> Dict[str, Any]:
        """Reject a pending trade."""
        pending = next(
            (t for t in self.pending_confirmations if t["confirmation_id"] == confirmation_id),
            None,
        )

        if not pending:
            return {"status": "failed", "reason": "Confirmation not found"}

        self.pending_confirmations.remove(pending)
        log.info(f"🚫 Trade rejected | ID: {confirmation_id}")

        return {
            "status": "cancelled",
            "confirmation_id": confirmation_id,
            "reason": "User rejected",
        }

    def get_pending_confirmations(self) -> List[Dict[str, Any]]:
        """Get all pending trade confirmations."""
        return self.pending_confirmations.copy()

    def get_trade_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get recent trade history."""
        return self.trades[-limit:]

    def get_status(self) -> Dict[str, Any]:
        """Get current controller status."""
        return {
            "mode": self.mode.value,
            "is_active": self.is_active,
            "paper_trading": self.paper_trading,
            "max_trade_size": self.max_trade_size,
            "require_confirmation": self.require_confirmation,
            "total_trades": len(self.trades),
            "pending_confirmations": len(self.pending_confirmations),
            "timestamp": datetime.utcnow().isoformat(),
        }

    def get_statistics(self) -> Dict[str, Any]:
        """Get trading statistics."""
        if not self.trades:
            return {
                "total_trades": 0,
                "buys": 0,
                "sells": 0,
                "total_volume": 0,
            }

        buys = [t for t in self.trades if t["action"].lower() == "buy"]
        sells = [t for t in self.trades if t["action"].lower() == "sell"]
        total_volume = sum(t["amount"] * t.get("price", 0) for t in self.trades)

        return {
            "total_trades": len(self.trades),
            "buys": len(buys),
            "sells": len(sells),
            "total_volume": total_volume,
            "avg_trade_size": total_volume / len(self.trades) if self.trades else 0,
            "last_trade": self.trades[-1] if self.trades else None,
        }


if __name__ == "__main__":
    # Example usage
    controller = TradingModeController(
        mode="manual",
        paper_trading=True,
        max_trade_size=1000,
        require_confirmation=True,
    )

    controller.start()

    # Manual trade
    result = controller.execute_trade(
        symbol="BTC/USDT",
        action="buy",
        amount=0.01,
        price=45000,
        source="manual",
    )
    print(f"Trade result: {result}")

    # Get status
    print(f"Status: {controller.get_status()}")
    print(f"Stats: {controller.get_statistics()}")
