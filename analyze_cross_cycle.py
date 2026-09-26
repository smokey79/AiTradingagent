"""
analyze_cross_cycle.py
========================
The per-cycle "best combo" picked by backtest_own_ohlcv.py answers "what
worked best in THIS regime" — which is exactly how you overfit a strategy
to one market condition. This script instead asks the more honest question:
"which single setting holds up best averaged ACROSS all 3 cycles for this
token" — a real cross-validation, not three independent one-offs.

Reads the CSVs backtest_own_ohlcv.py already saved (no re-fetching).
"""
import pandas as pd
import numpy as np
import json
from backtest_own_ohlcv import add_indicators, backtest, SYMBOLS

EMA_PAIRS = [(20, 50), (50, 200), (20, 100)]
RSI_MINS = [40, 45, 50]
ATR_MULTS = [1.5, 1.75, 2.0]
RR_RATIOS = [1.5, 2.0, 2.5]

def run_all_combos_one_cycle(df):
    """Every combo's result on one cycle (not just the top-1)."""
    out = {}
    for ema_fast, ema_slow in EMA_PAIRS:
        if len(df) < ema_slow + 30:
            continue
        d = add_indicators(df, ema_fast, ema_slow, 14, 12, 26, 9, 14, 20)
        for rsi_min in RSI_MINS:
            for atr_mult in ATR_MULTS:
                for rr in RR_RATIOS:
                    res = backtest(d, rsi_min, 70, 3.0, 1.0, atr_mult, rr)
                    key = (ema_fast, ema_slow, rsi_min, atr_mult, rr)
                    out[key] = res
    return out


def _score(res):
    """Same shape as grid_search()'s score: rewards profit factor and return,
    penalizes drawdown. Capped profit_factor so one freak trade can't dominate."""
    pf = min(res["profit_factor"], 5)
    return pf * (1 + res["total_return_pct"] / 100) / (1 + abs(res["max_drawdown_pct"]) / 100)


def split_cycles(df):
    """Identical split logic to three_cycle_backtest() in backtest_own_ohlcv.py
    so results line up 1:1 with the per-cycle-best numbers already reported."""
    n = len(df)
    third = n // 3
    return [df.iloc[0:third].reset_index(drop=True),
            df.iloc[third:2*third].reset_index(drop=True),
            df.iloc[2*third:].reset_index(drop=True)]


def cross_cycle_best(token, df, min_cycles_present=2, min_total_trades=15):
    """For one token: run every combo on every valid cycle, then find the
    combo(s) that actually held up across cycles rather than the combo that
    happened to win any single one.

    A combo only counts as a candidate if it produced trades in at least
    `min_cycles_present` of the valid cycles (so a fluke 1-cycle result can't
    win) and at least `min_total_trades` trades summed across those cycles
    (so the sample isn't too thin to trust). Ranked by mean score across the
    cycles it appears in.
    """
    cycles = split_cycles(df)
    valid_cycles = [c for c in cycles if len(c) >= 80]
    n_valid = len(valid_cycles)
    per_cycle_results = [run_all_combos_one_cycle(c) for c in valid_cycles]

    all_keys = set()
    for r in per_cycle_results:
        all_keys.update(r.keys())

    candidates = []
    for key in all_keys:
        cycle_hits = []
        for r in per_cycle_results:
            res = r.get(key)
            if res is not None:
                cycle_hits.append(res)
        if len(cycle_hits) < min(min_cycles_present, n_valid):
            continue
        total_trades = sum(h["trades"] for h in cycle_hits)
        if total_trades < min_total_trades:
            continue
        avg_score = sum(_score(h) for h in cycle_hits) / len(cycle_hits)
        avg_return = sum(h["total_return_pct"] for h in cycle_hits) / len(cycle_hits)
        avg_pf = sum(h["profit_factor"] for h in cycle_hits) / len(cycle_hits)
        avg_win_rate = sum(h["win_rate"] for h in cycle_hits) / len(cycle_hits)
        worst_dd = min(h["max_drawdown_pct"] for h in cycle_hits)
        candidates.append({
            "ema_fast": key[0], "ema_slow": key[1], "rsi_bull_min": key[2],
            "atr_mult": key[3], "rr_ratio": key[4],
            "cycles_present": len(cycle_hits), "cycles_valid": n_valid,
            "total_trades": total_trades,
            "avg_score": round(avg_score, 3), "avg_return_pct": round(avg_return, 1),
            "avg_profit_factor": round(avg_pf, 2), "avg_win_rate": round(avg_win_rate, 1),
            "worst_cycle_drawdown_pct": round(worst_dd, 1),
        })

    candidates.sort(key=lambda x: x["avg_score"], reverse=True)
    return {
        "token": token,
        "cycles_valid": n_valid,
        "candidates_found": len(candidates),
        "top_5": candidates[:5],
        "recommended": candidates[0] if candidates else None,
    }


if __name__ == "__main__":
    results = {}
    for token in SYMBOLS:
        csv_path = f"data/ohlcv/{token}_daily.csv"
        df = pd.read_csv(csv_path, parse_dates=["date"])
        print(f"\n=== {token}: cross-cycle robustness scan ===", flush=True)
        r = cross_cycle_best(token, df)
        results[token] = r
        if r["recommended"] is None:
            print(f"  No combo held up across >=2 cycles with >=15 total trades "
                  f"(too little/too inconsistent data — treat {token} as low-confidence).", flush=True)
        else:
            rec = r["recommended"]
            print(f"  ROBUST PICK: EMA({rec['ema_fast']},{rec['ema_slow']}) "
                  f"RSI-min {rec['rsi_bull_min']} ATRx{rec['atr_mult']} RR{rec['rr_ratio']} "
                  f"-> present in {rec['cycles_present']}/{rec['cycles_valid']} cycles, "
                  f"{rec['total_trades']} trades total, avg PF {rec['avg_profit_factor']}, "
                  f"avg return {rec['avg_return_pct']:+.1f}%, worst-cycle DD {rec['worst_cycle_drawdown_pct']}%", flush=True)
            print(f"  ({r['candidates_found']} combos passed the robustness filter total)", flush=True)

    with open("data/ohlcv/cross_cycle_robust_findings.json", "w") as f:
        json.dump(results, f, indent=2, default=str)
    print("\nSaved to data/ohlcv/cross_cycle_robust_findings.json")
