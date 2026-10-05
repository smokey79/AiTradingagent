"""
core/ledger_db.py  (2026-10-03 calibration)

Python access to data/ledger.db, the single SQLite trade ledger (schema: config/ledger_schema.sql, shared with
the Node side). Learning code must call real_trades(): closed, not simulated, fee-inclusive dry_run/live rows only.
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "config" / "ledger_schema.sql"
DB_PATH = Path(os.getenv("LEDGER_DB_PATH") or ROOT / "data" / "ledger.db")

COLUMNS = ("ext_id", "source", "engine", "is_simulated", "fees_included", "strategy", "enter_tag", "exit_reason",
           "pair", "side", "opened_at", "closed_at", "entry_price", "exit_price", "stake_usd", "leverage",
           "pnl_usd", "pnl_pct", "fees_usd", "slippage_usd", "outcome", "meta", "imported_at")

_UPSERT = (
    "INSERT INTO trades (" + ", ".join(COLUMNS) + ") VALUES (" + ", ".join(":" + c for c in COLUMNS) + ") "
    "ON CONFLICT (source, ext_id) DO UPDATE SET "
    "engine=excluded.engine, is_simulated=excluded.is_simulated, fees_included=excluded.fees_included, "
    "opened_at=excluded.opened_at, entry_price=excluded.entry_price, "
    "strategy=excluded.strategy, enter_tag=excluded.enter_tag, exit_reason=excluded.exit_reason, "
    "closed_at=excluded.closed_at, exit_price=excluded.exit_price, pnl_usd=excluded.pnl_usd, pnl_pct=excluded.pnl_pct, "
    "fees_usd=excluded.fees_usd, outcome=excluded.outcome, meta=excluded.meta, imported_at=excluded.imported_at"
)


def connect(read_only: bool = False) -> sqlite3.Connection:
    if read_only:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=10)
    else:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, timeout=10)
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.row_factory = sqlite3.Row
    return conn


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def upsert(conn: sqlite3.Connection, row: Dict[str, Any]) -> None:
    full = {c: row.get(c) for c in COLUMNS}
    full["imported_at"] = full["imported_at"] or now_iso()
    full["is_simulated"] = int(bool(full["is_simulated"]))
    full["fees_included"] = int(bool(full["fees_included"]))
    conn.execute(_UPSERT, full)


def real_trades(limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """Closed, not simulated, fee-inclusive dry_run/live trades, oldest first."""
    if not DB_PATH.exists():
        return []
    conn = connect(read_only=True)
    try:
        sql = "SELECT * FROM real_trades ORDER BY closed_at"
        if limit:
            sql += f" LIMIT {int(limit)}"
        return [dict(r) for r in conn.execute(sql).fetchall()]
    finally:
        conn.close()


def counts() -> Dict[str, int]:
    if not DB_PATH.exists():
        return {"total": 0, "real": 0, "simulated": 0}
    conn = connect(read_only=True)
    try:
        return {
            "total": conn.execute("SELECT COUNT(*) FROM trades").fetchone()[0],
            "real": conn.execute("SELECT COUNT(*) FROM real_trades").fetchone()[0],
            "simulated": conn.execute("SELECT COUNT(*) FROM trades WHERE is_simulated = 1").fetchone()[0],
        }
    finally:
        conn.close()
