from __future__ import annotations

"""
core/nexo_sweep.py

Auto-sweeps realised profit to Nexo BTC account.
Profits accumulate in a local ledger until they exceed
PROFIT_SWEEP_THRESHOLD_USD, then a withdrawal is triggered.

Alan J | barcay0611@gmail.com | github: smokey79
"""

import logging
import os
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Optional

import requests

logger = logging.getLogger(__name__)

NEXO_API_KEY         = os.getenv("NEXO_API_KEY", "")
NEXO_API_SECRET      = os.getenv("NEXO_API_SECRET", "")
NEXO_BTC_ADDRESS     = os.getenv("NEXO_BTC_ADDRESS", "")
SWEEP_THRESHOLD_USD  = float(os.getenv("PROFIT_SWEEP_THRESHOLD_USD", "100.0"))
PAPER_TRADE_MODE     = os.getenv("PAPER_TRADE_MODE", "true").lower() == "true"
LEDGER_PATH          = os.getenv("LEARNING_DB_PATH", "data/agent_memory.db")


class ProfitLedger:
    """Tracks accumulated profit awaiting sweep to Nexo."""

    def __init__(self, db_path: str = LEDGER_PATH) -> None:
        os.makedirs(os.path.dirname(db_path) if os.path.dirname(db_path) else ".", exist_ok=True)
        self.path = db_path
        self._init()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init(self) -> None:
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS profit_ledger (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp     TEXT NOT NULL,
                    trade_id      TEXT NOT NULL,
                    symbol        TEXT NOT NULL,
                    pnl_usd       REAL NOT NULL,
                    swept         INTEGER DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS sweep_log (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp     TEXT NOT NULL,
                    amount_usd    REAL NOT NULL,
                    btc_address   TEXT NOT NULL,
                    tx_ref        TEXT,
                    paper_mode    INTEGER DEFAULT 1
                );
            """)

    def add_profit(self, trade_id: str, symbol: str, pnl_usd: float) -> None:
        ts = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO profit_ledger (timestamp, trade_id, symbol, pnl_usd) VALUES (?,?,?,?)",
                (ts, trade_id, symbol, pnl_usd)
            )
        logger.info("Profit logged: trade=%s pnl=$%.2f", trade_id, pnl_usd)

    def pending_usd(self) -> float:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT COALESCE(SUM(pnl_usd), 0) FROM profit_ledger WHERE swept=0 AND pnl_usd > 0"
            ).fetchone()
        return row[0]

    def mark_swept(self) -> float:
        """Mark all pending positive entries as swept. Returns total swept."""
        total = self.pending_usd()
        ts = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            conn.execute(
                "UPDATE profit_ledger SET swept=1 WHERE swept=0 AND pnl_usd > 0"
            )
        return total

    def log_sweep(self, amount_usd: float, tx_ref: Optional[str], paper: bool) -> None:
        ts = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO sweep_log (timestamp, amount_usd, btc_address, tx_ref, paper_mode) VALUES (?,?,?,?,?)",
                (ts, amount_usd, NEXO_BTC_ADDRESS, tx_ref, int(paper))
            )


class NexoSweeper:
    """
    Monitors pending profit and sweeps to Nexo BTC address
    when threshold is reached.

    In PAPER_TRADE_MODE=true, all sweeps are simulated and logged only.
    """

    def __init__(self, ledger: Optional[ProfitLedger] = None) -> None:
        self.ledger = ledger or ProfitLedger()

    def record_trade_profit(self, trade_id: str, symbol: str, pnl_usd: float) -> None:
        """Call this after every completed trade."""
        if pnl_usd > 0:
            self.ledger.add_profit(trade_id, symbol, pnl_usd)
            self._check_and_sweep()

    def _check_and_sweep(self) -> None:
        pending = self.ledger.pending_usd()
        logger.debug("Pending profit: $%.2f / threshold $%.2f", pending, SWEEP_THRESHOLD_USD)

        if pending >= SWEEP_THRESHOLD_USD:
            self._execute_sweep(pending)

    def _execute_sweep(self, amount_usd: float) -> None:
        if PAPER_TRADE_MODE:
            logger.info(
                "[PAPER] Simulated sweep of $%.2f to BTC address %s",
                amount_usd, NEXO_BTC_ADDRESS or "NOT_SET"
            )
            self.ledger.mark_swept()
            self.ledger.log_sweep(amount_usd, tx_ref="PAPER_TRADE", paper=True)
            return

        if not NEXO_BTC_ADDRESS:
            logger.error("NEXO_BTC_ADDRESS not set — sweep aborted.")
            return

        # TODO: Replace stub with real Nexo API withdrawal call
        # Nexo API v2 withdrawal endpoint:
        # POST https://api.nexo.io/api/v2/withdrawals
        # Headers: X-API-KEY, X-NONCE, X-SIGNATURE (HMAC-SHA256)
        # Body: {"currency": "BTC", "amount": btc_amount, "wallet": NEXO_BTC_ADDRESS}
        #
        # Example (uncomment when API creds are confirmed):
        # import hmac, hashlib
        # nonce = str(int(time.time() * 1000))
        # sig = hmac.new(
        #     NEXO_API_SECRET.encode(),
        #     f"{NEXO_API_KEY}{nonce}".encode(),
        #     hashlib.sha256
        # ).hexdigest()
        # resp = requests.post(
        #     "https://api.nexo.io/api/v2/withdrawals",
        #     headers={"X-API-KEY": NEXO_API_KEY, "X-NONCE": nonce, "X-SIGNATURE": sig},
        #     json={"currency": "BTC", "amount": str(btc_amount), "wallet": NEXO_BTC_ADDRESS},
        #     timeout=30,
        # )
        # resp.raise_for_status()
        # tx_ref = resp.json().get("transactionId", "unknown")

        tx_ref = "STUB_NOT_WIRED"
        logger.warning(
            "LIVE SWEEP STUB: $%.2f → %s (tx_ref=%s) — wire Nexo API to activate",
            amount_usd, NEXO_BTC_ADDRESS, tx_ref
        )
        swept = self.ledger.mark_swept()
        self.ledger.log_sweep(swept, tx_ref=tx_ref, paper=False)

    def status(self) -> dict:
        return {
            "pending_profit_usd" : round(self.ledger.pending_usd(), 2),
            "sweep_threshold_usd": SWEEP_THRESHOLD_USD,
            "btc_address"        : NEXO_BTC_ADDRESS or "NOT_SET",
            "paper_mode"         : PAPER_TRADE_MODE,
        }
