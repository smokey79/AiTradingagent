"""
pybacktest/run_grid.py
======================
Coin x timeframe x strategy robustness lab on free exchange data. No keys, no credits.

    python -m pybacktest.run_grid                              # full default grid
    python -m pybacktest.run_grid --coins ETH,ARB --tfs 1h,2h  # subset
    python -m pybacktest.run_grid --parity research/multi_tf_lab_2026-09-24/results.json

Defaults: 17 coins (BTC ETH SOL AVAX ARB OP CRO LTC TRX ZEC SUI OKB ICP AAVE POL ATOM FLR)
x 8 timeframes (15m 30m 1h 2h 4h 6h 12h 1d) x 5 strategies (4 lab + ST_AI) = 680 cells, history from 2020-03-25.

Each cell is scored exactly like the TradingKit lab: pct profit factor, 2024+ out-of-sample
profit factor, 15%-exposure drawdown, plus a 200-sample bootstrap. A strategy is ROBUST only
if it passes on >= 3 coins and, on each of those, on >= 2 adjacent timeframes.

Output folder (default research/pylab_<today>): results.json (resumable - finished cells are
skipped on re-run), SUMMARY.md, and parity.md when --parity is given.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pybacktest import engine, metrics  # noqa: E402
from pybacktest.data import get_candles  # noqa: E402
from pybacktest.strategies import STRATEGIES  # noqa: E402

COINS = ["BTC", "ETH", "SOL", "AVAX", "ARB", "OP", "CRO",
         "LTC", "TRX", "ZEC", "SUI", "OKB", "ICP", "AAVE", "POL", "ATOM", "FLR"]  # +10 added 2026-09-24
TFS = ["15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"]
TK_TF = {"1D": "1d"}  # TradingKit label -> ours


def run_cell(coin, tf, strat, since, source):
    t0 = time.time()
    candles = get_candles(coin, tf, since=since, source=source)
    sig = STRATEGIES[strat](candles)
    trades = engine.run(candles, sig)
    s = metrics.summarize(trades)
    s.update(metrics.cell_verdict(s))
    s["bootstrap"] = metrics.bootstrap([t["pct"] for t in trades])
    s.update(id=f"PY_{strat}_{coin}_{tf}", strat=strat, coin=coin, tf=tf, candles=len(candles),
             data_source=candles[0].get("source") if candles else None,
             first_candle=candles[0]["timestamp"] if candles else None, seconds=round(time.time() - t0, 1))
    return s


def summary_md(results, strats, coins, tfs):
    ok = [r for r in results if "error" not in r]
    md = [f"# Python lab summary\n\nGenerated {date.today()} from {len(ok)} cells (free exchange data, no TradingKit).\n",
          "Cell = full-history pctPF / 2024+ OOS PF. **Bold** = passed every check. `-` = not run or error.\n"]
    robust = []
    for s in strats:
        md.append(f"\n## {s}\n\n| Coin | " + " | ".join(tfs) + " |\n|---|" + "---|" * len(tfs))
        coins_ok = 0
        for c in coins:
            cells = [next((r for r in ok if r["strat"] == s and r["coin"] == c and r["tf"] == t), None) for t in tfs]
            md.append(f"| {c} | " + " | ".join("-" if not x else (f"**{x['pct_pf']}/{x['oos_pf']}**" if x["pass"] else f"{x['pct_pf']}/{x['oos_pf']}") for x in cells) + " |")
            if any(x and x["pass"] and cells[i + 1] and cells[i + 1]["pass"] for i, x in enumerate(cells[:-1])):
                coins_ok += 1
        md.append(f"\nCoins with 2+ adjacent passing timeframes: **{coins_ok}**")
        if coins_ok >= 3:
            robust.append(s)
    passes = sum(1 for r in ok if r["pass"])
    md.append(f"\n## Verdict\n\nPassing cells: {passes} of {len(ok)} ({100 * passes / max(len(ok), 1):.1f}%). "
              + (f"ROBUST: {', '.join(robust)} - candidates for PAPER trading only.\n" if robust
                 else "No strategy is robust across coins and neighbouring timeframes; single passing cells are most likely luck.\n"))
    errs = [r for r in results if "error" in r]
    if errs:
        md.append("\n## Errors\n\n" + "\n".join(f"- {r['id']}: {r['error']}" for r in errs))
    return "\n".join(md)


def parity_md(results, tk_path):
    tk = [r for r in json.loads(Path(tk_path).read_text()) if r.get("status") == "OK"]
    rows, agree = [], 0
    for t in tk:
        tf = TK_TF.get(t["tfLabel"], t["tfLabel"])
        p = next((r for r in results if r.get("strat") == t["strat"] and r.get("coin") == t["coin"] and r.get("tf") == tf and "error" not in r), None)
        if not p:
            continue
        same = p["pass"] == t["pass"]
        agree += same
        rows.append(f"| {t['strat']} | {t['coin']} | {tf} | {t['trades']} / {p['trades']} | {t['pctPF']} / {p['pct_pf']} | {t['oosPF']} / {p['oos_pf']} | {'yes' if same else '**no**'} |")
    head = (f"# Parity check: TradingKit vs Python\n\nSame strategies, same rules, independent code and data "
            f"(TradingKit: Bybit perps via trader.dev; Python: {results[0].get('data_source') if results else '?'}).\n\n"
            f"Pass/fail verdict agrees on **{agree} of {len(rows)}** cells.\n\n"
            "| Strategy | Coin | TF | Trades TK / Py | PF TK / Py | OOS PF TK / Py | Same verdict |\n|---|---|---|---|---|---|---|")
    return head + "\n" + "\n".join(rows)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--coins", default=",".join(COINS))
    ap.add_argument("--tfs", default=",".join(TFS))
    ap.add_argument("--strategies", default=",".join(STRATEGIES))
    ap.add_argument("--since", default="2020-03-25")
    ap.add_argument("--source", default=None, help="force bybit | binance | okx (default: first that works)")
    ap.add_argument("--out", default=str(ROOT / "research" / f"pylab_{date.today():%Y-%m-%d}"))
    ap.add_argument("--parity", default=None, help="TradingKit results.json to compare against")
    a = ap.parse_args(argv)
    coins, tfs, strats = a.coins.split(","), a.tfs.split(","), a.strategies.split(",")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    res_path = out / "results.json"
    results = json.loads(res_path.read_text()) if res_path.exists() else []
    done = {r["id"] for r in results if "error" not in r}
    todo = [(c, t, s) for s in strats for c in coins for t in tfs if f"PY_{s}_{c}_{t}" not in done]
    print(f"{len(done)} cells done, {len(todo)} to run -> {out}")
    for k, (c, t, s) in enumerate(todo, 1):
        cid = f"PY_{s}_{c}_{t}"
        try:
            r = run_cell(c, t, s, a.since, a.source)
            print(f"[{k}/{len(todo)}] {cid}: {'PASS' if r['pass'] else 'fail'} PF={r['pct_pf']} OOS={r['oos_pf']} "
                  f"trades={r['trades']} DD15={r['dd15_pct']}% ({r['data_source']}, {r['seconds']}s)")
        except Exception as e:  # keep going; the error is recorded and retried next run
            r = {"id": cid, "strat": s, "coin": c, "tf": t, "error": str(e)[:300]}
            print(f"[{k}/{len(todo)}] {cid}: ERROR {r['error']}")
        results = [x for x in results if x["id"] != cid] + [r]
        tmp = res_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(results, indent=1))
        tmp.replace(res_path)
    (out / "SUMMARY.md").write_text(summary_md(results, strats, coins, tfs), encoding="utf-8")
    print(f"Summary: {out / 'SUMMARY.md'}")
    if a.parity:
        (out / "parity.md").write_text(parity_md(results, a.parity), encoding="utf-8")
        print(f"Parity report: {out / 'parity.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
