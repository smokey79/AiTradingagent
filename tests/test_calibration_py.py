r"""
tests/test_calibration_py.py (2026-10-03) -- Python side of the calibration work. Temp files only, no network, no live data.
Run from F:\aitradingagent:   .venv\Scripts\python.exe -m unittest tests.test_calibration_py -v
"""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Point the DB modules at temp files BEFORE importing them (they read the env at import time).
_TMP = tempfile.mkdtemp(prefix="calib_py_")
os.environ["LEDGER_DB_PATH"] = os.path.join(_TMP, "ledger.db")
os.environ["LEARNING_DB_PATH"] = os.path.join(_TMP, "agent_memory.db")

from core import ledger_db, realism  # noqa: E402
from agents.learning_agent import LearningAgent, TradeRecord  # noqa: E402
from orchestrator.strategy_evidence import Evidence, GateConfig, evaluate_gate  # noqa: E402


def candles(n=100, last_age_s=60, flat=False, volume=1000.0):
    now = time.time()
    out = []
    for i in range(n):
        ts = (now - (n - i) * 3600 + (3600 - last_age_s) - 3600) * 1000
        c = 100.0 if flat else 100 + (i % 7) * 0.5
        out.append([ts, c, c + 1, c - 1, c, volume])
    return out


class RealismTests(unittest.TestCase):
    def test_costs_match_the_json_and_the_node_side(self):
        self.assertAlmostEqual(realism.fee_pct_per_side(), 0.06)
        self.assertAlmostEqual(realism.slippage_pct_per_side(), 0.02)
        self.assertAlmostEqual(realism.round_trip_cost_pct(), 0.16)

    def test_promotion_bar(self):
        ok = dict(oos_trades=60, profit_factor=1.31, max_drawdown_pct=19.9, fees_included=True)
        self.assertTrue(realism.promotion_check(**ok)["passed"])
        self.assertFalse(realism.promotion_check(**{**ok, "oos_trades": 59})["passed"])
        self.assertFalse(realism.promotion_check(**{**ok, "profit_factor": 1.3})["passed"])
        self.assertFalse(realism.promotion_check(**{**ok, "max_drawdown_pct": 20})["passed"])
        self.assertFalse(realism.promotion_check(**{**ok, "fees_included": False})["passed"])
        self.assertFalse(realism.promotion_check(None, None, None, None)["passed"])

    def test_data_quality_gate(self):
        self.assertTrue(realism.data_quality_check(candles(), rsi14=55, atr14=1.5)["ok"])
        self.assertFalse(realism.data_quality_check(candles(), rsi14=100, atr14=1.5)["ok"])
        self.assertFalse(realism.data_quality_check(candles(), rsi14=55, atr14=0)["ok"])
        self.assertFalse(realism.data_quality_check(candles(flat=True), rsi14=55, atr14=1.5)["ok"])
        self.assertFalse(realism.data_quality_check(candles(last_age_s=9 * 3600), rsi14=55, atr14=1.5)["ok"])
        self.assertFalse(realism.data_quality_check(candles(volume=0), rsi14=55, atr14=1.5)["ok"])
        self.assertFalse(realism.data_quality_check(candles(n=20), rsi14=55, atr14=1.5)["ok"])
        self.assertFalse(realism.data_quality_check(candles(), candles_source="synthetic")["ok"])

    def test_min_order_comes_from_exchange_info(self):
        old_root = realism.ROOT
        try:
            realism.ROOT = Path(_TMP)
            (Path(_TMP) / "data").mkdir(exist_ok=True)
            (Path(_TMP) / "data" / "exchange_limits.json").write_text(json.dumps({
                "exchange": "bitget", "markets": {"BTC/USDT": {"minCostUsd": 1, "minAmount": 0.000001, "lastPrice": 60000}}}))
            self.assertAlmostEqual(realism.min_order_usd("BTCUSDT")["min_usd"], 1.05)
            self.assertIsNone(realism.min_order_usd("NOPE/USDT")["min_usd"])
        finally:
            realism.ROOT = old_root

    def test_flash_loan_lock(self):
        os.environ.pop("ARB_MODE", None)
        self.assertEqual(realism.arbitrage_mode(), "observe")
        self.assertFalse(realism.live_arb_allowed())


class LedgerAndLearningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        conn = ledger_db.connect()
        base = dict(source="dry_run", engine="freqtrade", pair="BTC/USDT", side="LONG", closed_at="2026-10-03T10:00:00Z",
                    entry_price=100.0, exit_price=101.0, stake_usd=25, pnl_usd=1.0, pnl_pct=1.0, outcome="WIN")
        ledger_db.upsert(conn, {**base, "ext_id": "real-1", "is_simulated": 0, "fees_included": 1, "enter_tag": "consensus_bridge_v1|c60|a7"})
        ledger_db.upsert(conn, {**base, "ext_id": "real-2", "is_simulated": 0, "fees_included": 1, "pnl_usd": -2.0, "outcome": "LOSS"})
        ledger_db.upsert(conn, {**base, "ext_id": "nofee", "is_simulated": 0, "fees_included": 0})
        ledger_db.upsert(conn, {**base, "ext_id": "flash", "is_simulated": 1, "fees_included": 0, "side": "FLASHLOAN"})
        ledger_db.upsert(conn, {**base, "ext_id": "legacy", "source": "legacy", "is_simulated": 1, "fees_included": 1})
        ledger_db.upsert(conn, {**base, "ext_id": "open-1", "is_simulated": 0, "fees_included": 1, "closed_at": None, "outcome": "PENDING"})
        conn.commit()
        conn.close()

    def test_real_trades_view(self):
        ids = {r["ext_id"] for r in ledger_db.real_trades()}
        self.assertEqual(ids, {"real-1", "real-2"})
        c = ledger_db.counts()
        self.assertEqual((c["total"], c["real"]), (6, 2))

    def test_learning_agent_refuses_unresolved_decisions(self):
        agent = LearningAgent()
        before = agent.db.total_trades()
        agent.after_trade(TradeRecord(trade_id="debate_1", timestamp="2026-10-03T10:00:00Z", symbol="BTCUSDT", action="LONG", size=0.1,
                                      entry_price=100.0, exit_price=100.0, pnl_usd=0.0, pnl_pct=0.0, hold_bars=0, pattern_name=None,
                                      signal_source="debate", llm_provider="router", features="{}", decision_reason="x", was_correct=True))
        self.assertEqual(agent.db.total_trades(), before, "a decision with entry == exit and pnl 0 must not be stored as a trade")

    def test_learning_agent_syncs_only_real_rows_once(self):
        agent = LearningAgent()
        n = agent.sync_from_ledger()
        self.assertEqual(n, 2)
        self.assertEqual(agent.sync_from_ledger(), 0, "second sync adds nothing")
        rows = agent.db.get_recent_trades(10)
        self.assertEqual({r["trade_id"] for r in rows}, {f"ledger-{r['id']}" for r in ledger_db.real_trades()})
        self.assertTrue(all(r["pnl_usd"] != 0 for r in rows))


class EvidenceGateTests(unittest.TestCase):
    def ev(self, **kw):
        base = dict(strategy_key="s", symbol="BTC/USDT", timeframe="1h", source="freqtrade", trades=150, wins=70, losses=80,
                    win_rate_pct=46.7, profit_factor=1.4, expectancy_pct=0.2, max_drawdown_pct=15.0,
                    oos_profit_factor=1.35, oos_trades=70, fees_included=True)
        base.update(kw)
        return Evidence(**base)

    def test_new_bar(self):
        cfg = GateConfig()
        self.assertEqual((cfg.min_oos_trades, cfg.min_profit_factor, cfg.max_drawdown_pct), (60, 1.3, 20.0))
        self.assertTrue(evaluate_gate(self.ev(), cfg)["passed"])
        self.assertFalse(evaluate_gate(self.ev(oos_trades=59), cfg)["passed"])
        self.assertFalse(evaluate_gate(self.ev(profit_factor=1.3), cfg)["passed"])
        self.assertFalse(evaluate_gate(self.ev(max_drawdown_pct=20.0), cfg)["passed"])
        self.assertFalse(evaluate_gate(self.ev(max_drawdown_pct=None), cfg)["passed"], "unknown drawdown must not pass")
        self.assertFalse(evaluate_gate(self.ev(fees_included=False), cfg)["passed"], "fees must be included")


if __name__ == "__main__":
    unittest.main()
