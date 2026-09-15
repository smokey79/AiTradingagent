"""
sopr_mvrv.py
============
Market valuation proxy indicators and cycle positioning metrics.
Models macro on-chain valuation approximations (MVRV proxy and Realized Profit proxy)
from price action, moving average cost bases, and volume distributions.
"""

from typing import List, Dict, Any, Optional


def calculate_mvrv_proxy(candles: List[Dict[str, Any]], short_period: int = 30, long_period: int = 200) -> Dict[str, Any]:
    """
    Approximates MVRV (Market Value to Realized Value) using Volume Weighted
    Moving Average cost bases.
    """
    if len(candles) < long_period:
        long_period = max(len(candles) // 2, 10)
        short_period = max(long_period // 4, 5)

    if len(candles) < 10:
        return {"mvrv_proxy": 1.0, "cycle_phase": "NEUTRAL", "valuation": "FAIR"}

    short_candles = candles[-short_period:]
    long_candles = candles[-long_period:]

    short_vol = sum(c["volume"] for c in short_candles)
    short_vwap = sum(c["close"] * c["volume"] for c in short_candles) / max(short_vol, 1e-6)

    long_vol = sum(c["volume"] for c in long_candles)
    long_vwap = sum(c["close"] * c["volume"] for c in long_candles) / max(long_vol, 1e-6)

    current_price = candles[-1]["close"]
    mvrv_proxy = round(current_price / max(long_vwap, 1e-6), 2)

    if mvrv_proxy > 2.5:
        cycle_phase = "OVERHEATED_DISTRIBUTION (High Macro Risk)"
        valuation = "OVERVALUED"
    elif mvrv_proxy > 1.4:
        cycle_phase = "BULL_MARKUP (Favorable Trend Expansion)"
        valuation = "MODERATELY_EXPENSIVE"
    elif mvrv_proxy < 0.9:
        cycle_phase = "DEEP_VALUE_ACCUMULATION (Historical Bottom Zone)"
        valuation = "UNDERVALUED"
    else:
        cycle_phase = "FAIR_VALUE_TRANSITION"
        valuation = "FAIR"

    return {
        "current_price": current_price,
        "realized_cost_basis_proxy": round(long_vwap, 2),
        "short_term_cost_basis": round(short_vwap, 2),
        "mvrv_proxy": mvrv_proxy,
        "cycle_phase": cycle_phase,
        "valuation": valuation,
    }
