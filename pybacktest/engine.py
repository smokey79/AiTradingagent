"""
pybacktest/engine.py
Bar-by-bar simulator matching the Pine template the TradingKit labs used
(research/btc_strategy_lab_2026-09-13/templates.js, wrapTrend):
  * process_orders_on_close: entry signals fill at that bar's close
  * pyramiding 1: an entry in the direction already held only resets the stop level
  * an opposite entry closes the open position at the close and reverses
  * ATR stop (price = close -/+ atr x mult, set on each entry signal) is active from the
    NEXT bar; filled at the stop, or at the open if the bar gaps through it
  * commission 0.05% per side, deducted from each trade's % return
Returns trades with % return on the trade's own notional, so results do not depend
on position size (same basis as the labs' pctPF / resimulation).
"""
from __future__ import annotations

from typing import Dict, List

FEE_PCT_PER_SIDE = 0.05


def _pnl(side: str, entry: float, exit_: float, fee: float) -> float:
    gross = (exit_ / entry - 1) * 100 if side == "long" else (entry / exit_ - 1) * 100
    return gross - 2 * fee


def run(candles: List[Dict], sig: Dict, fee_pct: float = FEE_PCT_PER_SIDE) -> List[Dict]:
    trades: List[Dict] = []
    pos = entry = entry_ts = None
    long_stop = short_stop = None
    atr, mult = sig["atr"], sig["atr_mult"]

    def close_at(i, px, reason):
        nonlocal pos, entry, entry_ts
        trades.append({"side": pos, "entry_time": entry_ts, "exit_time": candles[i]["timestamp"],
                       "entry": entry, "exit": px, "pct": _pnl(pos, entry, px, fee_pct), "reason": reason})
        pos = entry = entry_ts = None

    for i, b in enumerate(candles):
        # 1) stops placed on earlier bars
        if pos == "long" and long_stop is not None and b["low"] <= long_stop:
            close_at(i, min(b["open"], long_stop), "STOP")
        elif pos == "short" and short_stop is not None and b["high"] >= short_stop:
            close_at(i, max(b["open"], short_stop), "STOP")
        # 2) entries at the close
        a = atr[i]
        if sig["long"][i] and (mult is None or a is not None):
            if pos == "short":
                close_at(i, b["close"], "FLIP")
            if pos != "long":
                pos, entry, entry_ts = "long", b["close"], b["timestamp"]
            long_stop = b["close"] - a * mult if mult is not None else None
        if sig["short"][i] and (mult is None or a is not None):
            if pos == "long":
                close_at(i, b["close"], "FLIP")
            if pos != "short":
                pos, entry, entry_ts = "short", b["close"], b["timestamp"]
            short_stop = b["close"] + a * mult if mult is not None else None
    return trades  # a position still open at the end is not counted (same as the lab's closed-trade stats)
