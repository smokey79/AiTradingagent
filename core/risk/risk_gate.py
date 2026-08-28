"""
RiskGate — hard veto layer. Sits between consensus and execution.
Alan's rules:
  - Max leverage: 5x
  - Paper mode default (no live execution unless LIVE_MODE=true AND win_rate>=80% over 20+ trades)
  - Win rate gate: 80% over minimum 20 trades
  - Never trade without consensus (enforced upstream in ConsensusEngine)
  - Profit split at 2x initial deposit: 40% reinvest / 50% BTC / 10% long-term
  - Minimum odds filter: skip signals with avg_confidence < 0.55
"""
import os
import json
import logging
import sqlite3
from datetime import datetime

logger = logging.getLogger(__name__)

DB_PATH = os.getenv("DB_PATH", r"F:\aitradingagent\data\trading.db")
MIN_CONFIDENCE = 0.55        # Skip trades below this threshold
MIN_WIN_RATE = 0.80          # 80% gate before live mode
MIN_TRADE_SAMPLE = 20        # Must have at least 20 trades in history
MAX_LEVERAGE = 5.0
MAX_POSITION_PCT = 10.0      # Never more than 10% of portfolio per trade


class RiskGate:
    def __init__(self):
        self.live_mode = os.getenv("LIVE_MODE", "false").lower() == "true"
        self.initial_deposit = float(os.getenv("INITIAL_DEPOSIT", "100.0"))
        self._ensure_db()

    def _ensure_db(self):
        conn = sqlite3.connect(DB_PATH)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trade_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                symbol TEXT,
                signal TEXT,
                entry_price REAL,
                exit_price REAL,
                pnl_pct REAL,
                outcome TEXT,
                mode TEXT
            )
        """)
        conn.commit()
        conn.close()

    def get_win_rate(self) -> tuple[float, int]:
        """Returns (win_rate, total_trades)"""
        try:
            conn = sqlite3.connect(DB_PATH)
            cur = conn.execute(
                "SELECT COUNT(*), SUM(CASE WHEN outcome='WIN' THEN 1 ELSE 0 END) "
                "FROM trade_log WHERE mode='paper'"
            )
            row = cur.fetchone()
            conn.close()
            total = row[0] or 0
            wins = row[1] or 0
            rate = (wins / total) if total > 0 else 0.0
            return round(rate, 4), total
        except Exception:
            return 0.0, 0

    def evaluate(self, consensus: dict, portfolio_value: float) -> dict:
        """
        Returns:
        {
          "approved": bool,
          "reason": str,
          "adjusted_position_pct": float,
          "mode": "paper"|"live",
          "leverage_cap": float
        }
        """
        symbol = consensus.get("symbol", "?")
        signal = consensus.get("final_signal", "HOLD")
        confidence = consensus.get("avg_confidence", 0.0)
        consensus_reached = consensus.get("consensus_reached", False)
        constraints = consensus.get("constraints", {})

        # --- Hard veto conditions ---
        if signal == "HOLD":
            return self._veto("Signal is HOLD — no action", symbol)

        if not consensus_reached:
            return self._veto("No consensus reached — hard veto", symbol)

        if confidence < MIN_CONFIDENCE:
            return self._veto(
                f"Avg confidence {confidence:.2f} below minimum {MIN_CONFIDENCE}", symbol)

        # --- Win rate gate for live mode ---
        win_rate, trade_count = self.get_win_rate()
        mode = "paper"

        if self.live_mode:
            if trade_count < MIN_TRADE_SAMPLE:
                logger.warning(f"[RISK] Live mode requested but only {trade_count} trades "
                                f"(need {MIN_TRADE_SAMPLE}) — forcing paper")
            elif win_rate < MIN_WIN_RATE:
                logger.warning(f"[RISK] Win rate {win_rate:.1%} below {MIN_WIN_RATE:.0%} "
                                f"gate — forcing paper")
            else:
                mode = "live"
                logger.info(f"[RISK] Live mode approved: win_rate={win_rate:.1%} "
                             f"over {trade_count} trades")

        # --- Position sizing (tightest of agent constraints vs our cap) ---
        agent_pos = constraints.get("max_position_pct", MAX_POSITION_PCT)
        position_pct = min(agent_pos, MAX_POSITION_PCT)

        # Scale down if confidence is moderate
        if confidence < 0.70:
            position_pct *= 0.75

        position_pct = round(max(position_pct, 0.5), 2)  # floor at 0.5%

        logger.info(f"[RISK GATE] APPROVED {symbol} {signal} | "
                    f"mode={mode} pos={position_pct}% conf={confidence:.2f}")

        return {
            "approved": True,
            "symbol": symbol,
            "signal": signal,
            "reason": "Risk gate passed",
            "mode": mode,
            "adjusted_position_pct": position_pct,
            "stop_loss_pct": constraints.get("stop_loss_pct", 2.0),
            "take_profit_pct": constraints.get("take_profit_pct", 5.0),
            "leverage_cap": MAX_LEVERAGE,
            "confidence": confidence,
            "win_rate": win_rate,
            "trade_count": trade_count
        }

    def _veto(self, reason: str, symbol: str) -> dict:
        logger.warning(f"[RISK VETO] {symbol}: {reason}")
        return {"approved": False, "symbol": symbol, "reason": reason,
                "mode": "paper", "adjusted_position_pct": 0.0,
                "leverage_cap": 0.0}

    def log_trade_result(self, symbol: str, signal: str, entry: float,
                         exit_price: float, mode: str):
        """Call this after a trade closes to update win rate."""
        pnl_pct = ((exit_price - entry) / entry * 100) if signal == "BUY" \
                  else ((entry - exit_price) / entry * 100)
        outcome = "WIN" if pnl_pct > 0 else "LOSS"
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.execute("""
                INSERT INTO trade_log (timestamp, symbol, signal, entry_price,
                    exit_price, pnl_pct, outcome, mode)
                VALUES (?,?,?,?,?,?,?,?)
            """, (datetime.utcnow().isoformat(), symbol, signal,
                  entry, exit_price, round(pnl_pct, 4), outcome, mode))
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"Failed to log trade result: {e}")
