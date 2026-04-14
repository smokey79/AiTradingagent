from __future__ import annotations

"""
agents/learning_agent.py

Persistent learning layer for all trading agents.
Every trade outcome is logged to SQLite. The system:
  1. Records decisions + outcomes
  2. Computes rolling win-rate, avg R, and pattern performance
  3. Adapts strategy weights and LLM prompts based on what's working
  4. Flags underperforming patterns / signal sources for review

Alan J | barcay0611@gmail.com | github: smokey79
"""

import json
import logging
import os
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DB_PATH = os.getenv("LEARNING_DB_PATH", "data/agent_memory.db")
MIN_TRADES = int(os.getenv("MIN_TRADES_BEFORE_ADAPT", "50"))


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class TradeRecord:
    """One completed trade with outcome."""
    trade_id        : str
    timestamp       : str           # ISO-8601 UTC
    symbol          : str
    action          : str           # LONG | SHORT | FLAT
    size            : float
    entry_price     : float
    exit_price      : float
    pnl_usd         : float
    pnl_pct         : float
    hold_bars       : int
    pattern_name    : Optional[str] # e.g. "double_bottom"
    signal_source   : str           # "llm" | "baseline" | "youtube" | "tradingview"
    llm_provider    : str           # "anthropic" | "grok" | "openai"
    features        : str           # JSON-serialised feature dict at entry
    decision_reason : str
    was_correct     : bool          # did outcome match prediction?

@dataclass
class PatternPerformance:
    pattern_name    : str
    total_trades    : int
    wins            : int
    losses          : int
    win_rate        : float
    avg_r           : float
    avg_hold_bars   : float
    recommendation  : str           # "use" | "reduce" | "disable"

@dataclass
class SourcePerformance:
    source          : str
    total_signals   : int
    win_rate        : float
    avg_pnl_pct     : float
    recommendation  : str


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

class LearningDB:
    def __init__(self, path: str = DB_PATH) -> None:
        os.makedirs(os.path.dirname(path) if os.path.dirname(path) else ".", exist_ok=True)
        self.path = path
        self._init_schema()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS trades (
                    trade_id        TEXT PRIMARY KEY,
                    timestamp       TEXT NOT NULL,
                    symbol          TEXT NOT NULL,
                    action          TEXT NOT NULL,
                    size            REAL,
                    entry_price     REAL,
                    exit_price      REAL,
                    pnl_usd         REAL,
                    pnl_pct         REAL,
                    hold_bars       INTEGER,
                    pattern_name    TEXT,
                    signal_source   TEXT,
                    llm_provider    TEXT,
                    features        TEXT,
                    decision_reason TEXT,
                    was_correct     INTEGER
                );

                CREATE TABLE IF NOT EXISTS agent_weights (
                    key             TEXT PRIMARY KEY,
                    value           REAL NOT NULL,
                    updated_at      TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS learning_log (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp       TEXT NOT NULL,
                    event_type      TEXT NOT NULL,
                    detail          TEXT
                );
            """)
        logger.info("LearningDB initialised at %s", self.path)

    def log_trade(self, record: TradeRecord) -> None:
        with self._conn() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO trades VALUES (
                    :trade_id, :timestamp, :symbol, :action, :size,
                    :entry_price, :exit_price, :pnl_usd, :pnl_pct,
                    :hold_bars, :pattern_name, :signal_source, :llm_provider,
                    :features, :decision_reason, :was_correct
                )
            """, {**asdict(record), "was_correct": int(record.was_correct)})
        logger.debug("Logged trade %s: pnl=%.2f%%", record.trade_id, record.pnl_pct)

    def get_recent_trades(self, n: int = 100) -> List[Dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?", (n,)
            ).fetchall()
        return [dict(r) for r in rows]

    def total_trades(self) -> int:
        with self._conn() as conn:
            return conn.execute("SELECT COUNT(*) FROM trades").fetchone()[0]

    def set_weight(self, key: str, value: float) -> None:
        ts = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO agent_weights VALUES (?, ?, ?)",
                (key, value, ts)
            )

    def get_weight(self, key: str, default: float = 1.0) -> float:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT value FROM agent_weights WHERE key=?", (key,)
            ).fetchone()
        return row["value"] if row else default

    def log_event(self, event_type: str, detail: str) -> None:
        ts = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO learning_log (timestamp, event_type, detail) VALUES (?,?,?)",
                (ts, event_type, detail)
            )


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------

class LearningAnalytics:
    def __init__(self, db: LearningDB) -> None:
        self.db = db

    def rolling_win_rate(self, last_n: int = 100) -> float:
        trades = self.db.get_recent_trades(last_n)
        if not trades:
            return 0.0
        wins = sum(1 for t in trades if t["was_correct"])
        return wins / len(trades)

    def pattern_performance(self) -> List[PatternPerformance]:
        with self.db._conn() as conn:
            rows = conn.execute("""
                SELECT
                    pattern_name,
                    COUNT(*) as total,
                    SUM(was_correct) as wins,
                    AVG(pnl_pct) as avg_pnl,
                    AVG(hold_bars) as avg_hold
                FROM trades
                WHERE pattern_name IS NOT NULL
                GROUP BY pattern_name
            """).fetchall()

        results = []
        for r in rows:
            total  = r["total"]
            wins   = r["wins"] or 0
            losses = total - wins
            wr     = wins / total if total else 0.0
            rec    = "use" if wr >= 0.60 else ("reduce" if wr >= 0.45 else "disable")
            results.append(PatternPerformance(
                pattern_name  = r["pattern_name"],
                total_trades  = total,
                wins          = wins,
                losses        = losses,
                win_rate      = round(wr, 4),
                avg_r         = round(r["avg_pnl"] or 0.0, 4),
                avg_hold_bars = round(r["avg_hold"] or 0.0, 1),
                recommendation= rec,
            ))
        return sorted(results, key=lambda x: x.win_rate, reverse=True)

    def source_performance(self) -> List[SourcePerformance]:
        with self.db._conn() as conn:
            rows = conn.execute("""
                SELECT
                    signal_source,
                    COUNT(*) as total,
                    SUM(was_correct) as wins,
                    AVG(pnl_pct) as avg_pnl
                FROM trades
                GROUP BY signal_source
            """).fetchall()

        results = []
        for r in rows:
            total = r["total"]
            wr    = (r["wins"] or 0) / total if total else 0.0
            rec   = "use" if wr >= 0.60 else ("reduce" if wr >= 0.45 else "disable")
            results.append(SourcePerformance(
                source        = r["signal_source"],
                total_signals = total,
                win_rate      = round(wr, 4),
                avg_pnl_pct   = round(r["avg_pnl"] or 0.0, 4),
                recommendation= rec,
            ))
        return results

    def summary(self) -> Dict[str, Any]:
        total  = self.db.total_trades()
        recent = self.rolling_win_rate(100)
        return {
            "total_trades"      : total,
            "rolling_win_rate"  : recent,
            "target_win_rate"   : 0.68,
            "on_target"         : recent >= 0.68,
            "patterns"          : [asdict(p) for p in self.pattern_performance()],
            "sources"           : [asdict(s) for s in self.source_performance()],
            "ready_to_adapt"    : total >= MIN_TRADES,
        }


# ---------------------------------------------------------------------------
# Learning agent — adapts weights based on outcomes
# ---------------------------------------------------------------------------

class LearningAgent:
    """
    Continuously learns from trade outcomes and adjusts:
      - Pattern weights (which patterns to trust more/less)
      - Signal source weights (YouTube vs TradingView vs LLM)
      - LLM provider weights (which model is most accurate)

    Call `after_trade()` after every completed trade.
    Call `get_prompt_context()` to inject learned insights into LLM prompts.
    """

    def __init__(self, db: Optional[LearningDB] = None) -> None:
        self.db        = db or LearningDB()
        self.analytics = LearningAnalytics(self.db)

    def after_trade(self, record: TradeRecord) -> None:
        """Record outcome and trigger weight adaptation if enough data exists."""
        self.db.log_trade(record)

        total = self.db.total_trades()
        logger.info(
            "Trade logged [%d total] | correct=%s | pnl=%.2f%%",
            total, record.was_correct, record.pnl_pct,
        )

        if total >= MIN_TRADES and total % 10 == 0:
            self._adapt_weights()

    def _adapt_weights(self) -> None:
        """Update stored weights based on recent performance."""
        summary = self.analytics.summary()
        logger.info(
            "Adapting weights | win_rate=%.2f | on_target=%s",
            summary["rolling_win_rate"], summary["on_target"],
        )

        # Pattern weights
        for p in summary["patterns"]:
            key   = f"pattern:{p['pattern_name']}"
            value = p["win_rate"]
            self.db.set_weight(key, value)
            self.db.log_event(
                "weight_update",
                f"pattern={p['pattern_name']} wr={value:.2f} rec={p['recommendation']}"
            )

        # Source weights
        for s in summary["sources"]:
            key   = f"source:{s['source']}"
            value = s["win_rate"]
            self.db.set_weight(key, value)

        logger.info("Weight adaptation complete.")

    def get_pattern_weight(self, pattern_name: str) -> float:
        """Returns [0,1] weight for a pattern. 1.0 if not yet learned."""
        return self.db.get_weight(f"pattern:{pattern_name}", default=1.0)

    def get_source_weight(self, source: str) -> float:
        return self.db.get_weight(f"source:{source}", default=1.0)

    def get_prompt_context(self) -> str:
        """
        Returns a concise learning context string to inject into LLM prompts.
        This tells the LLM what has been working and what hasn't.
        """
        if self.db.total_trades() < MIN_TRADES:
            return f"(Insufficient trade history — {self.db.total_trades()}/{MIN_TRADES} trades logged)"

        summary = self.analytics.summary()
        wr      = summary["rolling_win_rate"]
        top_patterns = [
            p for p in summary["patterns"] if p["recommendation"] == "use"
        ][:3]
        weak_patterns = [
            p for p in summary["patterns"] if p["recommendation"] == "disable"
        ][:3]

        lines = [
            f"LEARNED CONTEXT (last 100 trades | win_rate={wr:.1%}):",
        ]
        if top_patterns:
            lines.append("High-performing patterns: " +
                         ", ".join(f"{p['pattern_name']}({p['win_rate']:.0%})" for p in top_patterns))
        if weak_patterns:
            lines.append("Underperforming patterns (avoid): " +
                         ", ".join(p["pattern_name"] for p in weak_patterns))

        return "\n".join(lines)

    def print_report(self) -> None:
        summary = self.analytics.summary()
        print("\n" + "="*65)
        print(f"  LEARNING REPORT  |  Total trades: {summary['total_trades']}")
        print(f"  Win rate: {summary['rolling_win_rate']:.1%}  |  Target: 68%  |  {'✅ ON TARGET' if summary['on_target'] else '❌ BELOW TARGET'}")
        print("="*65)
        print("\n  PATTERNS:")
        for p in summary["patterns"]:
            icon = "✅" if p["recommendation"] == "use" else ("⚠️" if p["recommendation"] == "reduce" else "❌")
            print(f"  {icon} {p['pattern_name']:<20} wr={p['win_rate']:.0%}  trades={p['total_trades']}")
        print("\n  SIGNAL SOURCES:")
        for s in summary["sources"]:
            icon = "✅" if s["recommendation"] == "use" else ("⚠️" if s["recommendation"] == "reduce" else "❌")
            print(f"  {icon} {s['source']:<20} wr={s['win_rate']:.0%}  trades={s['total_signals']}")
        print("="*65 + "\n")
