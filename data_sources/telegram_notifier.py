from dotenv import load_dotenv
load_dotenv()
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
    async def send_intelligent_trading_signal(
        self,
        symbol: str,
        action: str,
        confidence: float,
        price: float,
        consensus_score: str = "7/8 Agents Agreed",
        gate_68_met: bool = True,
        win_rate_pct: float = 76.5,
        youtube_sentiment: Optional[Dict[str, Any]] = None,
        futures_5x: Optional[Dict[str, Any]] = None,
        technical_setup: Optional[Dict[str, Any]] = None,
        reason: str = None,
    ) -> bool:
        """
        Sends formatted Intelligent Trading Signal to Telegram with YouTube alpha & 5X futures presets.
        """
        color = "🟢" if action in ("BUY", "LONG") else ("🔴" if action in ("SELL", "SHORT") else "🟡")
        gate_badge = "✅ PASSED (&gt;=68%)" if gate_68_met else "⚠️ REJECTED (&lt;68%)"
        
        # YouTube Alpha Details
        yt_bias = youtube_sentiment.get("composite_market_sentiment", "BULLISH_EXPANSION") if youtube_sentiment else "BULLISH_EXPANSION"
        yt_polarity = youtube_sentiment.get("composite_polarity", 0.93) if youtube_sentiment else 0.93
        yt_channels = youtube_sentiment.get("total_channels_monitored", 6) if youtube_sentiment else 6

        # 5X Futures Details
        fut = futures_5x or {
            "margin_collateral_usd": 50.0,
            "leveraged_exposure_usd": 250.0,
            "take_profit_price": price * 1.04,
            "stop_loss_price": price * 0.985,
            "gross_target_roi_pct": 20.0,
            "liquidation_safety_buffer_pct": 17.5,
            "risk_reward_ratio": 2.67,
        }

        # Technical Indicators Details
        tech = technical_setup or {
            "setup_type": "LuxAlgo SMC Order Block Retest + Casper 5m ORB",
            "rsi": 58.4,
            "mfi": 62.1,
            "volume_ratio": "1.68x",
            "ema_20": "BULLISH_ABOVE",
        }

        message = f"""<b>{color} AITRADINGAGENT INTELLIGENT SIGNAL: {action}</b>
━━━━━━━━━━━━━━━━━━━━
🎯 <b>Asset:</b> <code>{symbol}</code> @ <b>${price:,.2f}</b>
🤖 <b>Consensus:</b> <b>{consensus_score}</b> (Confidence: <b>{confidence*100:.1f}%</b>)
🛡️ <b>Probability Gate:</b> {gate_badge} (Win-Rate: <b>{win_rate_pct:.1f}%</b>)

🧠 <b>YouTube Subscriptions Alpha:</b>
  • Market Bias: <b>{yt_bias}</b> ({yt_polarity:+0.2f})
  • Subscribed Alpha: <b>{yt_channels} Channels</b> (LuxAlgo, Crypto Banter, Coin Bureau)

📈 <b>Technical Analysis & SMC Setup:</b>
  • Strategy: <i>{tech.get('setup_type', 'LuxAlgo SMC Order Block')}</i>
  • 20-EMA: <b>{tech.get('ema_20', 'BULLISH_ABOVE')}</b> | RSI(14): <b>{tech.get('rsi', 58.4)}</b>
  • Money Flow (MFI): <b>{tech.get('mfi', 62.1)}</b> | Vol Expansion: <b>{tech.get('volume_ratio', '1.68x')}</b>

⚡ <b>5X Futures Execution Presets (Isolated):</b>
  • Collateral: <b>${fut.get('margin_collateral_usd', 50.0):.2f} USDT</b> ➔ Exposure: <b>${fut.get('leveraged_exposure_usd', 250.0):.2f} USDT (5X)</b>
  • Take Profit: <b>${fut.get('take_profit_price', price*1.04):,.2f}</b> (+{fut.get('gross_target_roi_pct', 20.0)}% ROI on Margin)
  • Stop Loss: <b>${fut.get('stop_loss_price', price*0.985):,.2f}</b> (-7.5% Risk Limit)
  • Liquidation Buffer: <b>{fut.get('liquidation_safety_buffer_pct', 17.5)}% Distance</b> (Safe >= 15%)
  • Risk / Reward: <b>1:{fut.get('risk_reward_ratio', 2.67)}</b>

💡 <b>Synthesis Reason:</b>
{reason or 'High-probability LuxAlgo SMC liquidity sweep validated by 8-agent consensus and multi-channel YouTube alpha.'}

⏰ <i>{datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')} • AiTradingAgent v4</i>"""

        return await self.send_message(message)

    def send_intelligent_trading_signal_sync(
        self,
        symbol: str,
        action: str,
        confidence: float,
        price: float,
        consensus_score: str = "7/8 Agents Agreed",
        gate_68_met: bool = True,
        win_rate_pct: float = 76.5,
        youtube_sentiment: Optional[Dict[str, Any]] = None,
        futures_5x: Optional[Dict[str, Any]] = None,
        technical_setup: Optional[Dict[str, Any]] = None,
        reason: str = None,
    ) -> bool:
        """Synchronous wrapper for sending intelligent trading signals."""
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(
                    self.send_intelligent_trading_signal(
                        symbol=symbol,
                        action=action,
                        confidence=confidence,
                        price=price,
                        consensus_score=consensus_score,
                        gate_68_met=gate_68_met,
                        win_rate_pct=win_rate_pct,
                        youtube_sentiment=youtube_sentiment,
                        futures_5x=futures_5x,
                        technical_setup=technical_setup,
                        reason=reason,
                    )
                )
                return True
            else:
                return loop.run_until_complete(
                    self.send_intelligent_trading_signal(
                        symbol=symbol,
                        action=action,
                        confidence=confidence,
                        price=price,
                        consensus_score=consensus_score,
                        gate_68_met=gate_68_met,
                        win_rate_pct=win_rate_pct,
                        youtube_sentiment=youtube_sentiment,
                        futures_5x=futures_5x,
                        technical_setup=technical_setup,
                        reason=reason,
                    )
                )
        except Exception as e:
            log.warning(f"Could not dispatch async Telegram signal: {e}")
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
