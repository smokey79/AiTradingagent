"""
backtester/engine.py
====================
Backtesting engine for quantitative crypto strategies across the 7-token universe.
Simulates order fills, slippage, and fee friction on historical OHLCV data.
Integrates with Monte Carlo risk simulation to validate statistical robustness.
"""

import sys
from pathlib import Path

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import math
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

from risk.monte_carlo import MonteCarloRisk, MCConfig

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Backtester] %(message)s")
log = logging.getLogger("Backtester")


class BacktestEngine:
    """
    Simulates trading strategies across OHLCV bars.
    """

    def __init__(
        self,
        initial_capital: float = 1000.0,
        maker_fee_pct: float = 0.0004,   # 0.04%
        taker_fee_pct: float = 0.0006,   # 0.06%
        slippage_pct: float = 0.0005,    # 0.05%
    ):
        self.initial_capital = initial_capital
        self.maker_fee = maker_fee_pct
        self.taker_fee = taker_fee_pct
        self.slippage = slippage_pct

    def run_rsi_trend_strategy(
        self,
        candles: List[Dict[str, Any]],
        symbol: str = "BTC/USDT",
        rsi_period: int = 14,
        oversold_threshold: float = 35.0,
        overbought_threshold: float = 65.0,
        stop_loss_pct: float = 0.02,
        take_profit_pct: float = 0.04,
        position_size_pct: float = 0.05,
    ) -> Dict[str, Any]:
        """
        Executes a classic RSI Momentum + Trend Following backtest.
        """
        if len(candles) < rsi_period + 20:
            return {"error": "Insufficient candle data for backtest"}

        capital = self.initial_capital
        equity_curve = [capital]
        trades = []
        in_position = False
        entry_price = 0.0
        entry_time = ""
        position_usd = 0.0

        # Calculate RSIs
        closes = [c["close"] for c in candles]
        rsis = []
        for i in range(len(candles)):
            if i < rsi_period + 1:
                rsis.append(50.0)
            else:
                window = closes[: i + 1]
                changes = [window[k] - window[k - 1] for k in range(1, len(window))]
                gains = [c if c > 0 else 0.0 for c in changes[-rsi_period:]]
                losses = [abs(c) if c < 0 else 0.0 for c in changes[-rsi_period:]]
                avg_gain = sum(gains) / rsi_period
                avg_loss = sum(losses) / rsi_period
                rs = avg_gain / max(avg_loss, 1e-6)
                rsi = 100.0 - (100.0 / (1.0 + rs))
                rsis.append(rsi)

        # Simulation loop
        for i in range(20, len(candles)):
            current = candles[i]
            price = current["close"]
            timestamp = current.get("timestamp", str(i))
            rsi = rsis[i]
            prev_rsi = rsis[i - 1]

            if in_position:
                price_change = (price - entry_price) / entry_price
                is_tp = price_change >= take_profit_pct
                is_sl = price_change <= -stop_loss_pct
                is_rsi_exit = prev_rsi >= overbought_threshold and rsi < overbought_threshold

                if is_tp or is_sl or is_rsi_exit:
                    exit_price = price * (1.0 - self.slippage)
                    gross_pnl_pct = (exit_price - entry_price) / entry_price
                    gross_pnl_usd = position_usd * gross_pnl_pct
                    fee_usd = position_usd * self.taker_fee * 2
                    net_pnl_usd = gross_pnl_usd - fee_usd
                    net_return_pct = net_pnl_usd / position_usd

                    capital += net_pnl_usd
                    in_position = False

                    trades.append({
                        "symbol": symbol,
                        "entry_time": entry_time,
                        "exit_time": timestamp,
                        "entry_price": entry_price,
                        "exit_price": exit_price,
                        "pnl_usd": round(net_pnl_usd, 2),
                        "return_pct": round(net_return_pct * 100, 2),
                        "win": net_pnl_usd > 0,
                        "exit_reason": "TP" if is_tp else "SL" if is_sl else "RSI_REVERSAL",
                    })

            else:
                if prev_rsi <= oversold_threshold and rsi > oversold_threshold:
                    entry_price = price * (1.0 + self.slippage)
                    entry_time = timestamp
                    position_usd = capital * position_size_pct
                    in_position = True

            equity_curve.append(round(capital, 2))

        # Performance analytics
        total_trades = len(trades)
        wins = [t for t in trades if t["win"]]
        losses = [t for t in trades if not t["win"]]

        win_rate = len(wins) / max(total_trades, 1)
        avg_win = sum(t["return_pct"] for t in wins) / max(len(wins), 1) / 100
        avg_loss = abs(sum(t["return_pct"] for t in losses) / max(len(losses), 1)) / 100 if losses else 0.02
        avg_loss = max(avg_loss, 0.001)

        total_return_pct = ((capital - self.initial_capital) / self.initial_capital) * 100

        peak = self.initial_capital
        max_dd = 0.0
        for eq in equity_curve:
            if eq > peak:
                peak = eq
            dd = (peak - eq) / peak if peak > 0 else 0.0
            if dd > max_dd:
                max_dd = dd

        mc = MonteCarloRisk(
            win_rate=max(0.1, min(win_rate if total_trades >= 5 else 0.55, 0.95)),
            avg_win=max(avg_win, 0.01),
            avg_loss=max(avg_loss, 0.01),
        )
        mc_eval = mc.evaluate(account_balance=capital, proposed_position_pct=position_size_pct)

        return {
            "symbol": symbol,
            "candle_count": len(candles),
            "initial_capital_usdt": self.initial_capital,
            "final_capital_usdt": round(capital, 2),
            "total_return_pct": round(total_return_pct, 2),
            "max_drawdown_pct": round(max_dd * 100, 2),
            "total_trades": total_trades,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate_pct": round(win_rate * 100, 2),
            "avg_win_pct": round(avg_win * 100, 2),
            "avg_loss_pct": round(avg_loss * 100, 2),
            "profit_factor": round(
                (sum(t["pnl_usd"] for t in wins) / max(abs(sum(t["pnl_usd"] for t in losses)), 1e-6)), 2
            ),
            "monte_carlo_validation": mc_eval,
            "recent_trades": trades[-5:],
        }


if __name__ == "__main__":
    from data_sources.ccxt_feed import CCXTFeed

    feed = CCXTFeed()
    candles = feed.get_ohlcv("BTC/USDT", timeframe="1h", limit=100)
    engine = BacktestEngine()
    result = engine.run_rsi_trend_strategy(candles, symbol="BTC/USDT")
    print("\n=== BACKTEST RESULTS ===")
    print(f"Symbol: {result.get('symbol')} | Candles: {result.get('candle_count')} | Trades: {result.get('total_trades')}")
    print(f"Return: {result.get('total_return_pct')}% | Max Drawdown: {result.get('max_drawdown_pct')}%")
    print(f"Win Rate: {result.get('win_rate_pct')}% | Profit Factor: {result.get('profit_factor')}")
