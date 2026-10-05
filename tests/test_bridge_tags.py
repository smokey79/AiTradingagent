r"""
tests/test_bridge_tags.py (2026-10-03) -- ConsensusBridgeStrategy must tag every entry/exit (enter_tag / exit_tag).
Needs pandas + freqtrade, so run it with the Freqtrade virtual environment:
    freqtrade-stable\.venv\Scripts\python.exe -m unittest tests.test_bridge_tags -v      (from F:\aitradingagent)
No network, no exchange, no files other than the strategy itself.
"""
import importlib.util
import types
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
STRAT = ROOT / "freqtrade-stable" / "user_data" / "strategies" / "ConsensusBridgeStrategy.py"
spec = importlib.util.spec_from_file_location("ConsensusBridgeStrategy_under_test", STRAT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
S = mod.ConsensusBridgeStrategy


def run(signal):
    dummy = types.SimpleNamespace(_load_signals=lambda: {"BTC/USDT": signal} if signal is not None else {})
    df = pd.DataFrame({"date": pd.date_range("2026-10-03", periods=3, freq="5min"), "volume": [10.0, 10.0, 10.0]})
    df = S.populate_indicators(dummy, df, {"pair": "BTC/USDT"})
    df = S.populate_entry_trend(dummy, df, {"pair": "BTC/USDT"})
    df = S.populate_exit_trend(dummy, df, {"pair": "BTC/USDT"})
    return df


class BridgeTagTests(unittest.TestCase):
    def test_strategy_id(self):
        self.assertEqual(mod.STRATEGY_ID, "consensus_bridge_v1")

    def test_buy_is_tagged_with_confidence_bucket_and_agents(self):
        df = run({"signal": "BUY", "confidence": 0.62, "approved": True, "agentsAgreeing": 7})
        self.assertTrue((df["enter_long"] == 1).all())
        self.assertTrue((df["enter_tag"] == "consensus_bridge_v1|c60|a7").all(), df["enter_tag"].tolist())

    def test_full_confidence_stays_in_top_bucket(self):
        df = run({"signal": "BUY", "confidence": 1.0, "approved": True, "agentsAgreeing": 3})
        self.assertTrue((df["enter_tag"] == "consensus_bridge_v1|c90|a3").all(), df["enter_tag"].tolist())

    def test_missing_agent_count_is_zero(self):
        df = run({"signal": "BUY", "confidence": 0.5, "approved": True, "agentsAgreeing": None})
        self.assertTrue((df["enter_tag"] == "consensus_bridge_v1|c50|a0").all(), df["enter_tag"].tolist())

    def test_hold_unapproved_and_low_confidence_never_enter_or_tag(self):
        for sig in ({"signal": "HOLD", "confidence": 0.9, "approved": True},
                    {"signal": "BUY", "confidence": 0.9, "approved": False},
                    {"signal": "BUY", "confidence": 0.449, "approved": True},
                    None):
            df = run(sig)
            self.assertFalse(df.get("enter_long", pd.Series([0, 0, 0])).fillna(0).astype(int).any(), sig)
            self.assertTrue(df["enter_tag"].isna().all() if "enter_tag" in df else True, sig)

    def test_sell_is_tagged_as_exit(self):
        df = run({"signal": "SELL", "confidence": 0.7, "approved": True, "agentsAgreeing": 5})
        self.assertTrue((df["exit_long"] == 1).all())
        self.assertTrue((df["exit_tag"] == "consensus_bridge_v1|consensus_sell").all())


if __name__ == "__main__":
    unittest.main()
