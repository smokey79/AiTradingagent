"""
volatility_regimes.py
=====================
Calculates Average True Range (ATR), Bollinger Band Width (BBW),
and classifies the current volatility regime for risk management.
"""

import math
from typing import List, Dict, Any, Optional


def calculate_atr(candles: List[Dict[str, Any]], period: int = 14) -> Dict[str, float]:
    """
    Calculates Average True Range (ATR) and ATR percentage.
    """
    if len(candles) < period + 1:
        return {"atr": 0.0, "atr_pct": 0.0}

    tr_list = []
    for i in range(1, len(candles)):
        h = candles[i]["high"]
        l = candles[i]["low"]
        prev_c = candles[i - 1]["close"]
        tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
        tr_list.append(tr)

    atr = sum(tr_list[-period:]) / period
    current_price = candles[-1]["close"]
    atr_pct = (atr / current_price * 100) if current_price > 0 else 0.0

    return {
        "atr": round(atr, 4),
        "atr_pct": round(atr_pct, 2),
        "current_price": current_price,
    }


def calculate_bollinger_bands(candles: List[Dict[str, Any]], period: int = 20, num_std: float = 2.0) -> Dict[str, float]:
    """
    Calculates 20-period Bollinger Bands and Bandwidth %.
    """
    if len(candles) < period:
        return {"upper": 0.0, "middle": 0.0, "lower": 0.0, "bandwidth_pct": 0.0}

    closes = [c["close"] for c in candles[-period:]]
    sma = sum(closes) / period
    variance = sum((x - sma) ** 2 for x in closes) / period
    std = math.sqrt(variance)

    upper = sma + (std * num_std)
    lower = sma - (std * num_std)
    bandwidth_pct = ((upper - lower) / sma * 100) if sma > 0 else 0.0

    return {
        "upper": round(upper, 4),
        "middle": round(sma, 4),
        "lower": round(lower, 4),
        "bandwidth_pct": round(bandwidth_pct, 2),
        "std_dev": round(std, 4),
    }


def detect_volatility_regime(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Classifies market state into VOLATILITY COMPRESSION, NORMAL, or HIGH EXPANSION.
    """
    if not candles or len(candles) < 20:
        return {"regime": "INSUFFICIENT_DATA", "atr_pct": 0.0, "bbw_pct": 0.0}

    atr_data = calculate_atr(candles, period=14)
    bb_data = calculate_bollinger_bands(candles, period=20)

    atr_pct = atr_data["atr_pct"]
    bbw_pct = bb_data["bandwidth_pct"]

    if bbw_pct < 2.5 or atr_pct < 1.0:
        regime = "COMPRESSION_SQUEEZE (Imminent Breakout Setup)"
        risk_adjustment = "Tighter stops, prepare for directional breakout"
    elif bbw_pct > 8.0 or atr_pct > 4.5:
        regime = "HIGH_VOLATILITY_EXPANSION (High Trend / Exhaustion Risk)"
        risk_adjustment = "Reduce position size (high variance environment)"
    else:
        regime = "NORMAL_VOLATILITY (Optimal Trading Environment)"
        risk_adjustment = "Standard Kelly position sizing"

    return {
        "regime": regime,
        "atr": atr_data["atr"],
        "atr_pct": atr_pct,
        "bb_bandwidth_pct": bbw_pct,
        "bb_upper": bb_data["upper"],
        "bb_middle": bb_data["middle"],
        "bb_lower": bb_data["lower"],
        "guidance": risk_adjustment,
    }
