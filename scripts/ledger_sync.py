r"""
ledger_sync.py  (2026-10-03 calibration)

Imports trades into the single SQLite ledger (data/ledger.db). Idempotent: running it twice changes nothing.
  * Freqtrade dry-run DB  -> source 'dry_run', engine 'freqtrade', fees_included = 1 (Freqtrade profit is net of fees)
  * data/trade_ledger.json (Node paper engine) -> source 'dry_run', engine 'node_paper';
        fees_included only if the record carries costUsd; FLASHLOAN/simulated rows are flagged is_simulated = 1
  * --include-archives: the archived 17 flash-loan "wins" -> source 'legacy', is_simulated = 1 (audit trail only,
        never part of real_trades)
Usage:
  F:\aitradingagent\.venv\Scripts\python.exe scripts\ledger_sync.py [--include-archives] [--quiet]
"""
import argparse
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from core import ledger_db  # noqa: E402
from core.realism import pnl_stats  # noqa: E402

# (database file, ext_id prefix). The first is the archived first run; the second is the calibration run (2026-10-03 on).
FT_DBS = [
    (ROOT / "freqtrade-stable" / "freqtrade_bridge_dryrun.sqlite", "ft"),
    (ROOT / "freqtrade-stable" / "freqtrade_calibration_dryrun.sqlite", "ftc"),
]
JSON_LEDGER = ROOT / "data" / "trade_ledger.json"
ARCHIVE_LEDGER = ROOT / "runs" / "2026-09-29_200gbp" / "archive" / "trade_ledger.json.20260929-051306"


def ft_iso(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s)).strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return str(s)


def outcome_of(pnl):
    if pnl is None:
        return None
    return "WIN" if pnl > 0 else "LOSS" if pnl < 0 else "BREAKEVEN"


def import_freqtrade(conn):
    total = 0
    for db_path, prefix in FT_DBS:
        total += _import_one_freqtrade_db(conn, db_path, prefix)
    return total


def _import_one_freqtrade_db(conn, db_path, prefix):
    if not db_path.exists():
        return 0
    src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    n = 0
    for r in src.execute("select * from trades"):
        d = dict(r)
        closed = not d.get("is_open")
        pnl = d.get("close_profit_abs") if closed else None
        fees = None
        if d.get("fee_open_cost") is not None or d.get("fee_close_cost") is not None:
            fees = (d.get("fee_open_cost") or 0) + (d.get("fee_close_cost") or 0)
        ledger_db.upsert(conn, {
            "ext_id": f"{prefix}-{d['id']}", "source": "dry_run", "engine": "freqtrade",
            "is_simulated": 0, "fees_included": 1,
            "strategy": d.get("strategy"), "enter_tag": (d.get("enter_tag") or None),
            "exit_reason": d.get("exit_reason"),
            "pair": d["pair"], "side": "SHORT" if d.get("is_short") else "LONG",
            "opened_at": ft_iso(d.get("open_date")), "closed_at": ft_iso(d.get("close_date")) if closed else None,
            "entry_price": d.get("open_rate"), "exit_price": d.get("close_rate"),
            "stake_usd": d.get("stake_amount"), "leverage": d.get("leverage") or 1,
            "pnl_usd": pnl, "pnl_pct": (d["close_profit"] * 100) if closed and d.get("close_profit") is not None else None,
            "fees_usd": fees, "outcome": outcome_of(pnl) if closed else "PENDING",
            "meta": json.dumps({"timeframe": d.get("timeframe"), "amount": d.get("amount")}),
        })
        n += 1
    src.close()
    return n


def import_json_ledger(conn, path, source_override=None, force_simulated=False):
    if not path.exists():
        return 0
    n = 0
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except ValueError:
            continue
        side = str(e.get("side", "BUY")).upper()
        simulated = force_simulated or e.get("excludeFromLearning") is True or e.get("simulated") is True or e.get("isSimulated") is True or side == "FLASHLOAN"
        has_cost = e.get("feesIncluded") is not False and (e.get("feesIncluded") is True or e.get("costUsd") is not None)
        pending = e.get("outcome") == "PENDING"
        ledger_db.upsert(conn, {
            "ext_id": str(e.get("id")), "source": source_override or ("live" if e.get("paper") is False else "dry_run"),
            "engine": e.get("engine") or "node_paper",
            "is_simulated": 1 if simulated else 0, "fees_included": 1 if has_cost and not simulated else 0,
            "pair": e.get("pair") or e.get("symbol") or "UNKNOWN", "side": side,
            "opened_at": e.get("openedAt"),
            "closed_at": None if pending else (e.get("closedAt") or e.get("timestamp")),
            "entry_price": e.get("entryPrice"), "exit_price": None if pending else (e.get("exitPrice") if e.get("exitPrice") is not None else e.get("price")),
            "stake_usd": e.get("positionSizeUsd"), "leverage": e.get("leverage") or 1,
            "pnl_usd": e.get("pnlUsd"), "pnl_pct": e.get("pnlPct"), "fees_usd": e.get("costUsd"),
            "outcome": e.get("outcome"),
            "meta": json.dumps({"confidence": e.get("confidence"), "reason": e.get("reason"), "regime": e.get("regime"),
                                "agentVotes": e.get("agentVotes"), "excludeFromLearning": e.get("excludeFromLearning")}),
        })
        n += 1
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--include-archives", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    conn = ledger_db.connect()
    n_ft = import_freqtrade(conn)
    n_js = import_json_ledger(conn, JSON_LEDGER)
    n_arch = import_json_ledger(conn, ARCHIVE_LEDGER, source_override="legacy", force_simulated=True) if a.include_archives else 0
    conn.commit()
    conn.close()
    c = ledger_db.counts()
    real = ledger_db.real_trades()
    if not a.quiet:
        print(f"imported/updated: freqtrade={n_ft}  node_ledger={n_js}  archives={n_arch}")
        print(f"ledger.db: total={c['total']}  real(fee-inclusive, not simulated)={c['real']}  simulated={c['simulated']}")
        if real:
            wins = sum(1 for t in real if t["outcome"] == "WIN")
            s = pnl_stats([t["pnl_usd"] or 0 for t in real], 1000)
            print(f"real trades: n={len(real)} win_rate={wins/len(real):.1%} PF={s['profit_factor']} maxDD={s['max_drawdown_pct']}%")
            untagged = sum(1 for t in real if not t["enter_tag"])
            print(f"real trades without enter_tag: {untagged}/{len(real)}")


if __name__ == "__main__":
    main()
