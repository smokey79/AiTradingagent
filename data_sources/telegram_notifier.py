"""
telegram_notifier.py
====================
Telegram bot integration for trade alerts, signals, and notifications.
"""

import os
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime
import json

try:
    from telegram import Bot, Update
    from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
    from telegram.error import TelegramError
except ImportError:
    logging.warning("python-telegram-bot not installed. Install: pip install python-telegram-bot")

log = logging.getLogger("TelegramNotifier")


class TelegramNotifier:
    """
    Sends trade alerts, signals, and notifications to Telegram.
    """

    def __init__(
        self,
        bot_token: str = None,
        chat_id: str = None,
        enable_notifications: bool = True,
    ):
        """
        Initialize Telegram notifier.

        Args:
            bot_token: Telegram bot token (from BotFather)
            chat_id: Target chat ID for notifications
            enable_notifications: Enable/disable sending notifications
        """
        self.bot_token = bot_token or os.getenv("TELEGRAM_BOT_TOKEN")
        self.chat_id = chat_id or os.getenv("TELEGRAM_CHAT_ID")
        self.enabled = enable_notifications and bool(self.bot_token and self.chat_id)
        self.bot = None

        if self.enabled:
            try:
                self.bot = Bot(token=self.bot_token)
                log.info(f"Telegram bot initialized for chat: {self.chat_id}")
            except Exception as e:
                log.warning(f"Failed to initialize Telegram bot: {e}")
                self.enabled = False

    async def send_message(self, message: str, parse_mode: str = "HTML") -> bool:
        """
        Send a message to Telegram chat.

        Args:
            message: Message text (supports HTML formatting)
            parse_mode: 'HTML' or 'Markdown'

        Returns:
            True if sent successfully
        """
        if not self.enabled or not self.bot:
            return False

        try:
            await self.bot.send_message(
                chat_id=self.chat_id,
                text=message,
                parse_mode=parse_mode,
            )
            return True
        except TelegramError as e:
            log.error(f"Failed to send Telegram message: {e}")
            return False

    async def send_trade_signal(
        self,
        symbol: str,
        action: str,
        confidence: float,
        price: float,
        reason: str = None,
        metadata: Dict[str, Any] = None,
    ) -> bool:
        """
        Send a formatted trade signal notification.

        Args:
            symbol: Trading pair (e.g., "BTC/USDT")
            action: "BUY" or "SELL"
            confidence: Confidence score (0-1)
            price: Current price
            reason: Signal reason/explanation
            metadata: Additional data

        Returns:
            True if sent successfully
        """
        color = "🟢" if action == "BUY" else "🔴"
        confidence_pct = f"{confidence * 100:.1f}%"

        message = f"""
<b>{color} {action} SIGNAL</b>

<b>Symbol:</b> {symbol}
<b>Price:</b> ${price:,.2f}
<b>Confidence:</b> {confidence_pct}
<b>Time:</b> {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}

"""

        if reason:
            message += f"<b>Reason:</b> {reason}\n\n"

        if metadata:
            message += "<b>Metadata:</b>\n"
            for key, value in metadata.items():
                if isinstance(value, (int, float)):
                    message += f"  • {key}: {value:.2f}\n"
                else:
                    message += f"  • {key}: {value}\n"

        return await self.send_message(message)

    async def send_trade_execution(
        self,
        symbol: str,
        action: str,
        quantity: float,
        price: float,
        total_value: float,
        order_id: str = None,
        exchange: str = "Unknown",
    ) -> bool:
        """
        Send a trade execution notification.

        Args:
            symbol: Trading pair
            action: "BUY" or "SELL"
            quantity: Quantity traded
            price: Execution price
            total_value: Total value (quantity * price)
            order_id: Order ID from exchange
            exchange: Exchange name

        Returns:
            True if sent successfully
        """
        emoji = "✅" if action == "BUY" else "💰"

        message = f"""
<b>{emoji} TRADE EXECUTED</b>

<b>Action:</b> {action}
<b>Symbol:</b> {symbol}
<b>Exchange:</b> {exchange}
<b>Quantity:</b> {quantity}
<b>Price:</b> ${price:,.2f}
<b>Total Value:</b> ${total_value:,.2f}
<b>Time:</b> {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}

"""

        if order_id:
            message += f"<b>Order ID:</b> <code>{order_id}</code>\n"

        return await self.send_message(message)

    async def send_alert(
        self,
        title: str,
        description: str,
        alert_type: str = "INFO",
        data: Dict[str, Any] = None,
    ) -> bool:
        """
        Send a generic alert notification.

        Args:
            title: Alert title
            description: Alert description
            alert_type: "INFO", "WARNING", "ERROR", "SUCCESS"
            data: Additional data

        Returns:
            True if sent successfully
        """
        emoji_map = {
            "INFO": "ℹ️",
            "WARNING": "⚠️",
            "ERROR": "❌",
            "SUCCESS": "✅",
        }
        emoji = emoji_map.get(alert_type, "ℹ️")

        message = f"""
<b>{emoji} {alert_type}: {title}</b>

{description}

<b>Time:</b> {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}

"""

        if data:
            message += "<b>Details:</b>\n"
            for key, value in data.items():
                message += f"  • {key}: {value}\n"

        return await self.send_message(message)

    async def send_portfolio_update(
        self,
        balance: float,
        pnl: float,
        pnl_pct: float,
        positions: List[Dict[str, Any]] = None,
    ) -> bool:
        """
        Send a portfolio update notification.

        Args:
            balance: Current balance in USDT
            pnl: Profit/loss amount
            pnl_pct: Profit/loss percentage
            positions: List of open positions

        Returns:
            True if sent successfully
        """
        pnl_emoji = "📈" if pnl >= 0 else "📉"

        message = f"""
<b>💼 PORTFOLIO UPDATE</b>

<b>Balance:</b> ${balance:,.2f} USDT
<b>P{"}"}L:</b> {pnl_emoji} ${pnl:,.2f} ({pnl_pct:+.2f}%)
<b>Time:</b> {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}

"""

        if positions:
            message += "<b>Open Positions:</b>\n"
            for pos in positions[:5]:  # Limit to 5 positions
                message += f"  • {pos.get('symbol', 'N/A')}: {pos.get('quantity', 0)} @ ${pos.get('entry_price', 0):.2f}\n"

        return await self.send_message(message)

    async def send_error(self, error_title: str, error_msg: str, traceback_str: str = None) -> bool:
        """
        Send an error notification.

        Args:
            error_title: Error title
            error_msg: Error message
            traceback_str: Traceback (if available)

        Returns:
            True if sent successfully
        """
        message = f"""
<b>❌ ERROR</b>

<b>Title:</b> {error_title}
<b>Message:</b> {error_msg}

"""

        if traceback_str:
            message += f"<b>Traceback:</b>\n<code>{traceback_str[:500]}</code>\n"

        message += f"\n<b>Time:</b> {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}"

        return await self.send_message(message)

    async def start_bot(self) -> None:
        """Start bot polling for commands (optional)."""
        if not self.enabled or not self.bot:
            log.warning("Telegram bot not enabled or initialized")
            return

        try:
            application = Application.builder().token(self.bot_token).build()

            # Add handlers
            application.add_handler(CommandHandler("start", self._start_command))
            application.add_handler(CommandHandler("status", self._status_command))
            application.add_handler(CommandHandler("portfolio", self._portfolio_command))

            await application.run_polling()
        except Exception as e:
            log.error(f"Failed to start Telegram bot: {e}")

    async def _start_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle /start command."""
        await update.message.reply_text(
            "AiTradingAgent bot is running!\n"
            "Commands:\n"
            "/status - Get current status\n"
            "/portfolio - Get portfolio update"
        )

    async def _status_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle /status command."""
        await update.message.reply_text("🟢 Bot is online and monitoring trades.")

    async def _portfolio_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        """Handle /portfolio command."""
        await update.message.reply_text("📊 Portfolio update requested. Check the dashboard.")


if __name__ == "__main__":
    import asyncio

    # Example usage
    notifier = TelegramNotifier()

    if notifier.enabled:
        # Test notifications
        asyncio.run(
            notifier.send_alert(
                title="Bot Started",
                description="AiTradingAgent is now running and monitoring markets.",
                alert_type="SUCCESS",
            )
        )

        asyncio.run(
            notifier.send_trade_signal(
                symbol="BTC/USDT",
                action="BUY",
                confidence=0.85,
                price=45000,
                reason="Golden cross detected on 1h timeframe",
                metadata={"rsi": 65, "macd": "bullish", "volume": "high"},
            )
        )
    else:
        print("Telegram notifier not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID")
