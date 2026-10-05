r"""
calibration_report.py (2026-10-03) -- READ-ONLY. Where the calibration run stands against the promotion bar.
Run: F:\aitradingagent\.venv\Scripts\python.exe scripts\calibration_report.py
Syncs the ledger first (idempotent), then reports on REAL rows only (closed, fee-inclusive, not simulated).
"""
import math
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from core import ledger_db  # noqa: E402
from core.realism import pnl_stats, promotion_bar, promotion_check, round_trip_cost_pct  # noqa: E402

subprocess.run([sys.executable, str(ROOT / "scripts" / "ledger_sync.py"), "--quiet"], check=False)


def wilson(w, n, z=1.96):
    if n == 0:
        return (0.0, 0.0)
    p = w / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


bar = promotion_bar()
real = ledger_db.real_trades()
cnt = ledger_db.counts()
print(f"ledger.db: {cnt['total']} rows | real {cnt['real']} | simulated/legacy {cnt['simulated']}")
print(f"costs assumed: {round_trip_cost_pct():.2f}% round trip | bar: >= {bar['min_oos_trades']} OOS trades, PF > {bar['min_profit_factor']}, "
      f"DD < {bar['max_drawdown_pct']}%, live gate {bar['live_gate_win_rate']:.0%} over {bar['live_gate_min_trades']} trades")

if not real:
    print("\nNo real closed trades yet. Nothing to calibrate on; let the demo run.")
    sys.exit(0)

wins = sum(1 for t in real if t["outcome"] == "WIN")
n = len(real)
lo, hi = wilson(wins, n)
s = pnl_stats([t["pnl_usd"] or 0.0 for t in real], 250.0)
print(f"\nALL REAL TRADES: n={n} wins={wins} win rate {wins/n:.1%} (95% range {lo:.0%}-{hi:.0%}) PF {s['profit_factor']} maxDD {s['max_drawdown_pct']}% (on a $250 base)")
best2 = sorted((t["pnl_usd"] or 0.0 for t in real), reverse=True)[:2]
if n > 4:
    rest = sum(t["pnl_usd"] or 0.0 for t in real) - sum(best2)
    print(f"  excluding the 2 best trades: {rest:+.2f} USD over {n-2} trades ({rest/(n-2):+.2f} per trade)")

by = defaultdict(list)
for t in real:
    by[t["enter_tag"] or "(untagged: before 2026-10-03)"].append(t)
print("\nBY enter_tag (one strategy at a time):")
for tag, ts in sorted(by.items(), key=lambda kv: -len(kv[1])):
    w = sum(1 for t in ts if t["outcome"] == "WIN")
    st = pnl_stats([t["pnl_usd"] or 0.0 for t in ts], 250.0)
    print(f"  {tag[:46]:46s} n={len(ts):3d} win {w/len(ts):5.1%} PF {st['profit_factor']:6} DD {st['max_drawdown_pct']}%")

tagged = [t for t in real if t["enter_tag"]]
chk = promotion_check(len(tagged), pnl_stats([t["pnl_usd"] or 0.0 for t in tagged], 250.0)["profit_factor"] if tagged else None,
                      pnl_stats([t["pnl_usd"] or 0.0 for t in tagged], 250.0)["max_drawdown_pct"] if tagged else None, True)
print(f"\nPROMOTION CHECK (tagged calibration trades, n={len(tagged)}): {'PASSED' if chk['passed'] else 'not yet'}")
for r in chk["reasons"]:
    print("  -", r)
print(f"LIVE GATE progress: {min(n, bar['live_gate_min_trades'])}/{bar['live_gate_min_trades']} real trades (win rate needs >= {bar['live_gate_win_rate']:.0%})")
