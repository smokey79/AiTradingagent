"""
signals/supertrend_ai.py
========================
Python port of "SuperTrend AI (Clustering)" by LuxAlgo.

Original: https://www.luxalgo.com/library/indicator/supertrend-ai-clustering/
          https://www.tradingview.com/script/wP7WWjLL-SuperTrend-AI-Clustering-LuxAlgo/
Licence:  CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/) (c) LuxAlgo.
          Personal, non-commercial use only. This port keeps the same licence.

What it does
------------
Runs a SuperTrend for every ATR factor in a range (default 1.0 to 5.0 in 0.5 steps),
tracks how well each one would have performed (an exponentially smoothed score), groups
the factors into three performance clusters with k-means (worst / average / best), and
then draws ONE SuperTrend using the average factor of the chosen cluster (default: best).
A BUY is when that SuperTrend flips up, a SELL when it flips down. perf_idx (0 upward)
measures how strong the chosen cluster's recent performance is relative to price noise.

Faithfulness to the Pine script
-------------------------------
Bar-by-bar port of the published v6 source (settings, update order, na handling):
  * each factor's trend is decided on the PREVIOUS bar's bands, then the bands update
  * performance uses the previous bar's SuperTrend output
  * k-means starts from the 25/50/75th percentiles and runs until centroids stop moving
  * an empty "best" cluster keeps the previous target factor (Pine nz(..., prev))
Two deliberate differences, neither changes the signals:
  1. Pine only clusters the last `maxData` (10,000) bars for speed; here every bar is
     clustered, so older history is computed too (Pine shows na there).
  2. When a centroid is empty (na), Pine keeps iterating to maxIter because na == na is
     false; the port stops as soon as nothing changes, which gives the same result.

Repainting: none. Every value at bar i uses only bars 0..i.

Usage
-----
    from signals.supertrend_ai import supertrend_ai, latest_signal
    rows = supertrend_ai(candles)            # candles: list of dicts, oldest first,
                                            # keys: timestamp, open, high, low, close
    print(latest_signal(candles))           # {'signal': 'BUY'|'SELL'|None, ...}

Command line demo (downloads free Bybit/Binance data, no API key):
    python -m signals.supertrend_ai ETH 4h
Standard library only - no numpy/pandas needed.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence

__all__ = ["supertrend_ai", "latest_signal", "percentile_linear"]


def percentile_linear(values: Sequence[float], pct: float) -> float:
    """Linear-interpolation percentile (same method as numpy's default)."""
    s = sorted(values)
    if not s:
        return math.nan
    if len(s) == 1:
        return s[0]
    k = (len(s) - 1) * pct / 100.0
    lo = math.floor(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def _atr(candles, length: int) -> List[Optional[float]]:
    """ta.atr: RMA (Wilder) of true range, seeded with the SMA of the first `length` values."""
    out: List[Optional[float]] = [None] * len(candles)
    trs = []
    prev = None
    for i, c in enumerate(candles):
        tr = c["high"] - c["low"] if i == 0 else max(
            c["high"] - c["low"], abs(c["high"] - candles[i - 1]["close"]), abs(c["low"] - candles[i - 1]["close"]))
        trs.append(tr)
        if i == length - 1:
            prev = sum(trs) / length
            out[i] = prev
        elif i >= length:
            prev = (prev * (length - 1) + tr) / length
            out[i] = prev
    return out


def _ema_series(values: List[Optional[float]], length: int) -> List[Optional[float]]:
    """ta.ema over a series that may start with None; seeded with the SMA of the first `length` values."""
    out: List[Optional[float]] = [None] * len(values)
    alpha = 2.0 / (length + 1)
    buf = []
    prev = None
    for i, v in enumerate(values):
        if v is None:
            continue
        if prev is None:
            buf.append(v)
            if len(buf) == length:
                prev = sum(buf) / length
                out[i] = prev
        else:
            prev = alpha * v + (1 - alpha) * prev
            out[i] = prev
    return out


def _mean(xs):
    return sum(xs) / len(xs) if xs else None


def _kmeans3(data: List[float], factors: List[float], max_iter: int):
    """Pine's 1-D k-means with 3 clusters. Returns (perf_clusters, factor_clusters)."""
    centroids: List[Optional[float]] = [percentile_linear(data, 25), percentile_linear(data, 50), percentile_linear(data, 75)]
    perf_c = fac_c = None
    for _ in range(max_iter + 1):
        perf_c, fac_c = [[], [], []], [[], [], []]
        for v, f in zip(data, factors):
            best, best_d = None, None
            for idx, c in enumerate(centroids):
                if c is None:
                    continue
                d = abs(v - c)
                if best_d is None or d < best_d:
                    best, best_d = idx, d
            perf_c[best].append(v)
            fac_c[best].append(f)
        new = [_mean(pc) for pc in perf_c]
        if new == centroids:
            break
        centroids = new
    return perf_c, fac_c


def supertrend_ai(candles: List[Dict], length: int = 10, min_mult: float = 1, max_mult: float = 5,
                  step: float = 0.5, perf_alpha: float = 10, from_cluster: str = "Best",
                  max_iter: int = 1000) -> List[Dict]:
    """Returns one dict per candle: os (1 up / 0 down), ts (trailing stop), target_factor,
    perf_idx, perf_ama and signal ('BUY' on a flip up, 'SELL' on a flip down, else None)."""
    if min_mult > max_mult:
        raise ValueError("Minimum factor is greater than maximum factor in the range")
    n_f = int((max_mult - min_mult) / step)
    factors = [min_mult + i * step for i in range(n_f + 1)]
    frm = {"Best": 2, "Average": 1, "Worst": 0}[from_cluster]
    if not candles:
        return []

    hl2_0 = (candles[0]["high"] + candles[0]["low"]) / 2
    holder = [{"upper": hl2_0, "lower": hl2_0, "output": None, "perf": 0.0, "trend": 0} for _ in factors]
    atr = _atr(candles, length)
    absdiff = [None] + [abs(candles[i]["close"] - candles[i - 1]["close"]) for i in range(1, len(candles))]
    den = _ema_series(absdiff, int(perf_alpha))
    a = 2.0 / (perf_alpha + 1)

    target_factor = None
    upper = lower = hl2_0
    os_ = 0
    perf_ama = None
    prev_ts = None
    out = []
    for i, c in enumerate(candles):
        close, hl2 = c["close"], (c["high"] + c["low"]) / 2
        close1 = candles[i - 1]["close"] if i > 0 else None

        # 1) every factor's SuperTrend and performance score
        for f, h in zip(factors, holder):
            up = hl2 + atr[i] * f if atr[i] is not None else None
            dn = hl2 - atr[i] * f if atr[i] is not None else None
            h["trend"] = 1 if (h["upper"] is not None and close > h["upper"]) else (
                0 if (h["lower"] is not None and close < h["lower"]) else h["trend"])
            h["upper"] = (min(up, h["upper"]) if (up is not None and h["upper"] is not None) else None) \
                if (close1 is not None and h["upper"] is not None and close1 < h["upper"]) else up
            h["lower"] = (max(dn, h["lower"]) if (dn is not None and h["lower"] is not None) else None) \
                if (close1 is not None and h["lower"] is not None and close1 > h["lower"]) else dn
            diff = 0.0
            if close1 is not None and h["output"] is not None:
                diff = math.copysign(1.0, close1 - h["output"]) if close1 != h["output"] else 0.0
            chg = close - close1 if close1 is not None else 0.0
            h["perf"] += a * (chg * diff - h["perf"])
            h["output"] = h["lower"] if h["trend"] == 1 else h["upper"]

        # 2) cluster the factors by performance
        perf_c, fac_c = _kmeans3([h["perf"] for h in holder], factors, max_iter)
        tf = _mean(fac_c[frm])
        if tf is not None:
            target_factor = tf
        best_perf = _mean(perf_c[frm]) or 0.0
        perf_idx = (max(best_perf, 0.0) / den[i]) if (den[i] not in (None, 0)) else None

        # 3) the single SuperTrend from the chosen cluster's factor
        up = hl2 + atr[i] * target_factor if (atr[i] is not None and target_factor is not None) else None
        dn = hl2 - atr[i] * target_factor if (atr[i] is not None and target_factor is not None) else None
        upper = (min(up, upper) if (up is not None and upper is not None) else None) \
            if (close1 is not None and upper is not None and close1 < upper) else up
        lower = (max(dn, lower) if (dn is not None and lower is not None) else None) \
            if (close1 is not None and lower is not None and close1 > lower) else dn
        prev_os = os_
        if upper is not None and close > upper:
            os_ = 1
        elif lower is not None and close < lower:
            os_ = 0
        ts = lower if os_ else upper

        if prev_ts is None and ts is not None:
            perf_ama = ts
        elif perf_ama is not None and ts is not None and perf_idx is not None:
            perf_ama += perf_idx * (ts - perf_ama)
        prev_ts = ts

        signal = "BUY" if os_ > prev_os else ("SELL" if os_ < prev_os else None)
        out.append({"timestamp": c.get("timestamp"), "os": os_, "ts": ts, "target_factor": target_factor,
                    "perf_idx": perf_idx, "perf_ama": perf_ama, "signal": signal})
    return out


def latest_signal(candles: List[Dict], **kw) -> Dict:
    """Most recent CLOSED-bar state. Pass only closed candles (drop the forming one)."""
    rows = supertrend_ai(candles, **kw)
    if not rows:
        return {"signal": None, "trend": None}
    last = rows[-1]
    since = next((len(rows) - 1 - k for k in range(len(rows) - 1, -1, -1) if rows[k]["signal"]), None)
    return {"signal": last["signal"], "trend": "UP" if last["os"] == 1 else "DOWN", "trailing_stop": last["ts"],
            "target_factor": last["target_factor"], "perf_idx": last["perf_idx"],
            "bars_since_flip": since, "timestamp": last["timestamp"]}


if __name__ == "__main__":  # demo: python -m signals.supertrend_ai ETH 4h
    import sys
    from pybacktest.data import get_candles
    coin = sys.argv[1] if len(sys.argv) > 1 else "ETH"
    tf = sys.argv[2] if len(sys.argv) > 2 else "4h"
    candles = get_candles(coin, tf, since="2025-01-01")
    print(coin, tf, latest_signal(candles[:-1]))
