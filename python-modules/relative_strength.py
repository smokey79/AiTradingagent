"""
relative_strength.py
====================
Calculates Relative Strength Index (RSI), momentum metrics, and relative
performance vs BTC across the 7-token universe.
"""

import math
from typing import List, Dict, Any, Optional


def calculate_rsi(prices: List[float], period: int = 14) -> float:
    """
    Computes standard Wilder's Relative Strength Index (RSI).
    """
    if len(prices) < period + 1:
        return 50.0

    changes = [prices[i] - prices[i - 1] for i in range(1, len(prices))]
    gains = [c if c > 0 else 0.0 for c in changes]
    losses = [abs(c) if c < 0 else 0.0 for c in changes]

    # Initial average
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    # Smoothed averages
    for i in range(period, len(changes)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100.0 - (100.0 / (1.0 + rs)), 2)


def rank_relative_strength(ohlcv_by_symbol: Dict[str, List[Dict[str, Any]]], benchmark_symbol: str = "BTC/USDT") -> List[Dict[str, Any]]:
    """
    Ranks symbols by relative strength vs BTC and standard RSI momentum.
    """
    rankings = []
    btc_candles = ohlcv_by_symbol.get(benchmark_symbol, [])
    btc_return = 0.0
    if len(btc_candles) >= 2:
        btc_return = (btc_candles[-1]["close"] - btc_candles[0]["close"]) / btc_candles[0]["close"]

    for sym, candles in ohlcv_by_symbol.items():
        if not candles or len(candles) < 15:
            continue

        closes = [c["close"] for c in candles]
        rsi_14 = calculate_rsi(closes, period=14)
        asset_return = (closes[-1] - closes[0]) / closes[0]
        alpha_vs_btc = asset_return - btc_return

        state = "NEUTRAL"
        if rsi_14 >= 70:
            state = "OVERBOUGHT"
        elif rsi_14 <= 30:
            state = "OVERSOLD"
        elif alpha_vs_btc > 0.05:
            state = "OUTPERFORMING"
        elif alpha_vs_btc < -0.05:
            state = "UNDERPERFORMING"

        rankings.append({
            "symbol": sym,
            "current_price": closes[-1],
            "rsi_14": rsi_14,
            "period_return_pct": round(asset_return * 100, 2),
            "alpha_vs_btc_pct": round(alpha_vs_btc * 100, 2),
            "status": state,
        })

    rankings.sort(key=lambda x: x["alpha_vs_btc_pct"], reverse=True)
    return rankings
