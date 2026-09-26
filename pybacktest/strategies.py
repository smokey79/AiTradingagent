"""
pybacktest/strategies.py
Strategy definitions. Each returns per-bar entry signals plus the stop rule, in the same
shape the engine expects:
    {"long": [bool], "short": [bool], "atr": [float|None], "atr_mult": float|None}
atr_mult None = no ATR stop (the position is only closed by an opposite signal).

Included:
  EMA_VWAP, EMA_VWAP_ADX20, EMA_ADX20_ATR15, EMA_ADX20_ATR25
      the 4 locked strategies from the TradingKit labs (13 Sep / 24 Sep 2026),
      same logic as research/btc_strategy_lab_2026-09-13/templates.js wrapTrend
  ST_AI
      SuperTrend AI (Clustering) flips (signals/supertrend_ai.py): long on a flip up,
      short on a flip down, always in the market (the indicator's own trailing stop
      is what flips it), default LuxAlgo settings.
"""
from __future__ import annotations

from . import indicators as ind

LAB = {
    "EMA_VWAP":        dict(vwap=True,  adx=None, atr_mult=2.0),
    "EMA_VWAP_ADX20":  dict(vwap=True,  adx=20,   atr_mult=2.0),
    "EMA_ADX20_ATR15": dict(vwap=False, adx=20,   atr_mult=1.5),
    "EMA_ADX20_ATR25": dict(vwap=False, adx=20,   atr_mult=2.5),
}


def lab_signals(candles, name: str):
    s = LAB[name]
    close = [c["close"] for c in candles]
    e50, e100 = ind.ema(close, 50), ind.ema(close, 100)
    atr = ind.atr(candles, 14)
    adx = ind.adx(candles, 14) if s["adx"] else None
    vwap = ind.vwap_daily(candles) if s["vwap"] else None
    L, S = [False] * len(candles), [False] * len(candles)
    for i in range(1, len(candles)):
        if None in (e50[i], e100[i], e50[i - 1], e100[i - 1]):
            continue
        up = e50[i] > e100[i] and e50[i - 1] <= e100[i - 1]
        dn = e50[i] < e100[i] and e50[i - 1] >= e100[i - 1]
        adx_ok = not s["adx"] or (adx[i] is not None and adx[i] > s["adx"])
        L[i] = up and adx_ok and (not s["vwap"] or close[i] > vwap[i])
        S[i] = dn and adx_ok and (not s["vwap"] or close[i] < vwap[i])
    return {"long": L, "short": S, "atr": atr, "atr_mult": s["atr_mult"]}


def st_ai_signals(candles, **kw):
    from signals.supertrend_ai import supertrend_ai
    rows = supertrend_ai(candles, **kw)
    return {"long": [r["signal"] == "BUY" for r in rows], "short": [r["signal"] == "SELL" for r in rows],
            "atr": [None] * len(rows), "atr_mult": None}


STRATEGIES = {**{k: (lambda c, k=k: lab_signals(c, k)) for k in LAB}, "ST_AI": st_ai_signals}
