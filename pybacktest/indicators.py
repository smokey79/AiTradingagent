"""
pybacktest/indicators.py
Pine-equivalent indicators (standard library only), matching TradingView/TradingKit:
  ema  = ta.ema  (seeded with the SMA of the first `n` values)
  rma  = ta.rma  (Wilder smoothing, SMA seed)
  atr  = ta.atr  (RMA of true range)
  adx  = ta.dmi's ADX (RMA smoothing)
  vwap_daily = ta.vwap(close) with the session resetting at 00:00 UTC
Inputs are lists; outputs are lists of the same length with None until warmed up.
"""
from __future__ import annotations

from typing import List, Optional

Series = List[Optional[float]]


def ema(values: List[float], n: int) -> Series:
    out: Series = [None] * len(values)
    a = 2.0 / (n + 1)
    for i in range(len(values)):
        if i == n - 1:
            out[i] = sum(values[:n]) / n
        elif i >= n:
            out[i] = a * values[i] + (1 - a) * out[i - 1]
    return out


def rma(values: Series, n: int) -> Series:
    out: Series = [None] * len(values)
    run = []
    prev = None
    for i, v in enumerate(values):
        if v is None:
            run = []
            continue
        if prev is None:
            run.append(v)
            if len(run) == n:
                prev = sum(run) / n
                out[i] = prev
        else:
            prev = (prev * (n - 1) + v) / n
            out[i] = prev
    return out


def true_range(c) -> List[float]:
    out = []
    for i, b in enumerate(c):
        if i == 0:
            out.append(b["high"] - b["low"])
        else:
            pc = c[i - 1]["close"]
            out.append(max(b["high"] - b["low"], abs(b["high"] - pc), abs(b["low"] - pc)))
    return out


def atr(c, n: int = 14) -> Series:
    return rma(true_range(c), n)


def adx(c, n: int = 14) -> Series:
    pdm, mdm = [None], [None]
    for i in range(1, len(c)):
        up = c[i]["high"] - c[i - 1]["high"]
        dn = c[i - 1]["low"] - c[i]["low"]
        pdm.append(up if (up > dn and up > 0) else 0.0)
        mdm.append(dn if (dn > up and dn > 0) else 0.0)
    tr = true_range(c)
    tr[0] = None
    trr, pr, mr = rma(tr, n), rma(pdm, n), rma(mdm, n)
    dx: Series = []
    for i in range(len(c)):
        if trr[i] in (None, 0) or pr[i] is None or mr[i] is None:
            dx.append(None)
            continue
        p, m = 100 * pr[i] / trr[i], 100 * mr[i] / trr[i]
        dx.append(0.0 if p + m == 0 else 100 * abs(p - m) / (p + m))
    return rma(dx, n)


def vwap_daily(c) -> List[float]:
    out, day, pv, vv = [], None, 0.0, 0.0
    for b in c:
        d = b["timestamp"] // 86_400_000
        if d != day:
            day, pv, vv = d, 0.0, 0.0
        pv += b["close"] * b["volume"]
        vv += b["volume"]
        out.append(pv / vv if vv > 0 else b["close"])
    return out
