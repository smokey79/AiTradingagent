"""
bitget_exchange.py
==================
Bitget exchange integration using CCXT adapter.
Includes trading, portfolio management, and order tracking.
"""

import os
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime
import ccxt

log = logging.getLogger("BitgetExchange")


class BitgetExchange:
    """
    Bitget exchange adapter using CCXT for unified interface.
    Supports spot and futures trading.
    """

    def __init__(
        self,
        api_key: str = None,
        secret: str = None,
        passphrase: str = None,
        sandbox: bool = True,
        trading_mode: str = "spot",
    ):
        """
        Initialize Bitget exchange connection.

        Args:
            api_key: Bitget API key
            secret: Bitget API secret
            passphrase: Bitget API passphrase
            sandbox: Use sandbox/testnet (default: True)
            trading_mode: "spot" or "futures"
        """
        self.api_key = api_key or os.getenv("BITGET_API_KEY", "")
        self.secret = secret or os.getenv("BITGET_SECRET", "")
        self.passphrase = passphrase or os.getenv("BITGET_API_PASSPHRASE", "")
        self.sandbox = sandbox
        self.trading_mode = trading_mode
        self.exchange = None

        self._initialize_exchange()

    def _initialize_exchange(self) -> None:
        """Initialize CCXT Bitget exchange."""
        try:
            exchange_config = {
                "apiKey": self.api_key,
                "secret": self.secret,
                "password": self.passphrase,
                "enableRateLimit": True,
                "options": {
                    "defaultType": self.trading_mode,
                    "sandbox": self.sandbox,
                },
            }

            self.exchange = ccxt.bitget(exchange_config)
            log.info(
                f"Bitget initialized | Mode: {self.trading_mode} | "
                f"Sandbox: {self.sandbox} | Authenticated: {bool(self.api_key)}"
            )
        except Exception as e:
            log.error(f"Failed to initialize Bitget: {e}")
            self.exchange = None

    def is_connected(self) -> bool:
        """Check if exchange is connected and authenticated."""
        return self.exchange is not None and bool(self.api_key)

    def get_balance(self) -> Optional[Dict[str, Any]]:
        """
        Get account balance across all currencies.

        Returns:
            Dict with balance data (total, free, used)
        """
        if not self.exchange:
            log.error("Exchange not initialized")
            return None

        try:
            balance = self.exchange.fetch_balance()
            log.info(f"Balance fetched: {len(balance)} currencies")
            return balance
        except Exception as e:
            log.error(f"Error fetching balance: {e}")
            return None

    def get_total_balance_usd(self) -> Optional[float]:
        """
        Get total account balance in USDT.

        Returns:
            Total balance in USDT
        """
        balance = self.get_balance()
        if not balance:
            return None

        try:
            usdt_balance = balance.get("USDT", {}).get("free", 0)
            return usdt_balance
        except Exception as e:
            log.error(f"Error calculating total balance: {e}")
            return None

    def get_ticker(self, symbol: str) -> Optional[Dict[str, Any]]:
        """
        Get ticker data for a trading pair.

        Args:
            symbol: Trading pair (e.g., "BTC/USDT")

        Returns:
            Ticker data with bid, ask, last price, volume, etc.
        """
        if not self.exchange:
            return None

        try:
            ticker = self.exchange.fetch_ticker(symbol)
            return ticker
        except Exception as e:
            log.error(f"Error fetching ticker for {symbol}: {e}")
            return None

    def get_order_book(self, symbol: str, limit: int = 20) -> Optional[Dict[str, List]]:
        """
        Get order book (bids and asks).

        Args:
            symbol: Trading pair
            limit: Number of levels

        Returns:
            Dict with 'bids' and 'asks' lists
        """
        if not self.exchange:
            return None

        try:
            orderbook = self.exchange.fetch_order_book(symbol, limit)
            return orderbook
        except Exception as e:
            log.error(f"Error fetching order book for {symbol}: {e}")
            return None

    def get_ohlcv(self, symbol: str, timeframe: str = "1h", limit: int = 100) -> Optional[List]:
        """
        Get OHLCV (candlestick) data.

        Args:
            symbol: Trading pair
            timeframe: Timeframe ("1m", "5m", "1h", "1d", etc.)
            limit: Number of candles

        Returns:
            List of [timestamp, open, high, low, close, volume]
        """
        if not self.exchange:
            return None

        try:
            ohlcv = self.exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
            return ohlcv
        except Exception as e:
            log.error(f"Error fetching OHLCV for {symbol}: {e}")
            return None

    def get_trades(self, symbol: str, limit: int = 50) -> Optional[List[Dict[str, Any]]]:
        """
        Get recent trades for a symbol.

        Args:
            symbol: Trading pair
            limit: Number of trades

        Returns:
            List of recent trades
        """
        if not self.exchange:
            return None

        try:
            trades = self.exchange.fetch_trades(symbol, limit=limit)
            return trades
        except Exception as e:
            log.error(f"Error fetching trades for {symbol}: {e}")
            return None

    def create_market_order(
        self,
        symbol: str,
        side: str,
        amount: float,
    ) -> Optional[Dict[str, Any]]:
        """
        Create a market order (buy or sell).

        Args:
            symbol: Trading pair (e.g., "BTC/USDT")
            side: "buy" or "sell"
            amount: Quantity to trade

        Returns:
            Order response with order ID and details
        """
        if not self.exchange:
            log.error("Exchange not initialized")
            return None

        if not self.api_key:
            log.error("API credentials required for trading")
            return None

        try:
            order = self.exchange.create_market_order(symbol, side, amount)
            log.info(f"Market order created: {side} {amount} {symbol} | Order ID: {order.get('id')}")
            return order
        except Exception as e:
            log.error(f"Error creating market order: {e}")
            return None

    def create_limit_order(
        self,
        symbol: str,
        side: str,
        amount: float,
        price: float,
    ) -> Optional[Dict[str, Any]]:
        """
        Create a limit order.

        Args:
            symbol: Trading pair
            side: "buy" or "sell"
            amount: Quantity
            price: Limit price

        Returns:
            Order response
        """
        if not self.exchange or not self.api_key:
            return None

        try:
            order = self.exchange.create_limit_order(symbol, side, amount, price)
            log.info(f"Limit order created: {side} {amount} {symbol} @ ${price} | Order ID: {order.get('id')}")
            return order
        except Exception as e:
            log.error(f"Error creating limit order: {e}")
            return None

    def cancel_order(self, order_id: str, symbol: str) -> Optional[Dict[str, Any]]:
        """
        Cancel an open order.

        Args:
            order_id: Order ID
            symbol: Trading pair

        Returns:
            Cancelled order details
        """
        if not self.exchange or not self.api_key:
            return None

        try:
            cancelled = self.exchange.cancel_order(order_id, symbol)
            log.info(f"Order cancelled: {order_id}")
            return cancelled
        except Exception as e:
            log.error(f"Error cancelling order: {e}")
            return None

    def get_order(self, order_id: str, symbol: str) -> Optional[Dict[str, Any]]:
        """
        Get order status.

        Args:
            order_id: Order ID
            symbol: Trading pair

        Returns:
            Order details with status
        """
        if not self.exchange:
            return None

        try:
            order = self.exchange.fetch_order(order_id, symbol)
            return order
        except Exception as e:
            log.error(f"Error fetching order {order_id}: {e}")
            return None

    def get_open_orders(self, symbol: str = None) -> Optional[List[Dict[str, Any]]]:
        """
        Get all open orders.

        Args:
            symbol: Optional symbol filter

        Returns:
            List of open orders
        """
        if not self.exchange:
            return None

        try:
            if symbol:
                orders = self.exchange.fetch_open_orders(symbol)
            else:
                orders = self.exchange.fetch_open_orders()
            return orders
        except Exception as e:
            log.error(f"Error fetching open orders: {e}")
            return None

    def get_closed_orders(self, symbol: str = None, limit: int = 50) -> Optional[List[Dict[str, Any]]]:
        """
        Get closed orders history.

        Args:
            symbol: Optional symbol filter
            limit: Number of orders

        Returns:
            List of closed orders
        """
        if not self.exchange:
            return None

        try:
            if symbol:
                orders = self.exchange.fetch_closed_orders(symbol, limit=limit)
            else:
                orders = self.exchange.fetch_closed_orders(limit=limit)
            return orders
        except Exception as e:
            log.error(f"Error fetching closed orders: {e}")
            return None

    def get_my_trades(self, symbol: str = None, limit: int = 50) -> Optional[List[Dict[str, Any]]]:
        """
        Get account's trade history.

        Args:
            symbol: Optional symbol filter
            limit: Number of trades

        Returns:
            List of trades
        """
        if not self.exchange:
            return None

        try:
            if symbol:
                trades = self.exchange.fetch_my_trades(symbol, limit=limit)
            else:
                trades = self.exchange.fetch_my_trades(limit=limit)
            return trades
        except Exception as e:
            log.error(f"Error fetching my trades: {e}")
            return None

    def get_positions(self) -> Optional[List[Dict[str, Any]]]:
        """
        Get open positions (futures only).

        Returns:
            List of positions with P/L data
        """
        if not self.exchange or self.trading_mode != "futures":
            return None

        try:
            positions = self.exchange.fetch_positions()
            return positions
        except Exception as e:
            log.error(f"Error fetching positions: {e}")
            return None

    def get_deposits(self, limit: int = 50) -> Optional[List[Dict[str, Any]]]:
        """
        Get deposit history.

        Args:
            limit: Number of deposits

        Returns:
            List of deposit transactions
        """
        if not self.exchange:
            return None

        try:
            deposits = self.exchange.fetch_deposits(limit=limit)
            return deposits
        except Exception as e:
            log.error(f"Error fetching deposits: {e}")
            return None

    def get_withdrawals(self, limit: int = 50) -> Optional[List[Dict[str, Any]]]:
        """
        Get withdrawal history.

        Args:
            limit: Number of withdrawals

        Returns:
            List of withdrawal transactions
        """
        if not self.exchange:
            return None

        try:
            withdrawals = self.exchange.fetch_withdrawals(limit=limit)
            return withdrawals
        except Exception as e:
            log.error(f"Error fetching withdrawals: {e}")
            return None

    def get_markets(self, symbol: str = None) -> Optional[List[Dict[str, Any]]]:
        """
        Get available markets/trading pairs.

        Args:
            symbol: Optional symbol filter

        Returns:
            List of markets
        """
        if not self.exchange:
            return None

        try:
            markets = self.exchange.load_markets()
            if symbol:
                return [m for m in markets.values() if m["symbol"] == symbol]
            return list(markets.values())
        except Exception as e:
            log.error(f"Error fetching markets: {e}")
            return None


if __name__ == "__main__":
    # Example usage
    bitget = BitgetExchange(sandbox=True)

    if bitget.is_connected():
        # Get balance
        balance = bitget.get_total_balance_usd()
        print(f"Total Balance: ${balance:,.2f} USDT")

        # Get ticker
        ticker = bitget.get_ticker("BTC/USDT")
        if ticker:
            print(f"BTC/USDT: ${ticker['last']:,.2f}")

        # Get open orders
        orders = bitget.get_open_orders()
        print(f"Open Orders: {len(orders) if orders else 0}")
    else:
        print("Bitget not configured. Set API credentials in .env file.")
