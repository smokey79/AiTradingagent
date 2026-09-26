"""
pybacktest/metrics.py
Scoring used by the labs, so Python and TradingKit results are directly comparable:
  pct_pf        profit factor from each trade's own % return (sizing-independent)
  resim         equity curve if each trade used `exposure` of the account (default 15%)
  split         in-sample (< 2024-01-01) vs out-of-sample (>= 2024-01-01) by entry time
  cell_verdict  the per-cell pass bar from research/multi_tf_lab_2026-09-24
  bootstrap     share of shuffled/resampled trade sequences that end profitable
"""
from __future__ import annotations

import random
from typing import Dict, List

OOS_FROM_MS = 1_704_067_200_000  # 2024-01-01 00:00 UTC
BAR = dict(min_trades=100, min_oos_trades=30, min_pf=1.2, min_oos_pf=1.1, max_dd=25.0)


def pct_pf(rets: List[float]) -> float:
    gw = sum(r for r in rets if r > 0)
    gl = -sum(r for r in rets if r < 0)
    if gl == 0:
        return 99.0 if gw > 0 else 0.0
    return gw / gl


def resim(rets: List[float], exposure: float = 0.15) -> Dict[str, float]:
    eq = peak = 1.0
    dd = 0.0
    for r in rets:
        eq *= 1 + exposure * r / 100
        peak = max(peak, eq)
        dd = max(dd, (peak - eq) / peak * 100)
    return {"net_pct": (eq - 1) * 100, "max_dd_pct": dd}


def summarize(trades: List[Dict], exposure: float = 0.15) -> Dict:
    rets = [t["pct"] for t in trades]
    ins = [t["pct"] for t in trades if t["entry_time"] < OOS_FROM_MS]
    oos = [t["pct"] for t in trades if t["entry_time"] >= OOS_FROM_MS]
    r = resim(rets, exposure)
    return {
        "trades": len(rets), "win_rate_pct": round(100 * sum(1 for x in rets if x > 0) / len(rets), 1) if rets else None,
        "pct_pf": round(pct_pf(rets), 3), "in_trades": len(ins), "in_pf": round(pct_pf(ins), 3),
        "oos_trades": len(oos), "oos_pf": round(pct_pf(oos), 3),
        "avg_trade_pct": round(sum(rets) / len(rets), 4) if rets else None,
        "net15_pct": round(r["net_pct"], 1), "dd15_pct": round(r["max_dd_pct"], 1),
    }


def cell_verdict(s: Dict) -> Dict:
    why = []
    if s["trades"] < BAR["min_trades"]:
        why.append(f"trades {s['trades']}<{BAR['min_trades']}")
    if s["pct_pf"] < BAR["min_pf"]:
        why.append(f"PF {s['pct_pf']}<{BAR['min_pf']}")
    if s["oos_trades"] < BAR["min_oos_trades"]:
        why.append(f"OOS trades {s['oos_trades']}<{BAR['min_oos_trades']}")
    if s["oos_pf"] < BAR["min_oos_pf"]:
        why.append(f"OOS PF {s['oos_pf']}<{BAR['min_oos_pf']}")
    if s["dd15_pct"] > BAR["max_dd"]:
        why.append(f"DD@15% {s['dd15_pct']}>{BAR['max_dd']}")
    return {"pass": not why, "fail_reasons": why}


def bootstrap(rets: List[float], n: int = 200, exposure: float = 0.15, seed: int = 7) -> Dict:
    if not rets:
        return {"profitable_share": None}
    rnd = random.Random(seed)
    wins = 0
    dds = []
    for _ in range(n):
        sample = [rnd.choice(rets) for _ in rets]
        r = resim(sample, exposure)
        wins += r["net_pct"] > 0
        dds.append(r["max_dd_pct"])
    dds.sort()
    return {"profitable_share": round(wins / n, 3), "dd_p95": round(dds[int(0.95 * (n - 1))], 1)}
