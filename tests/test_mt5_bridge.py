"""
tests/test_mt5_bridge.py - offline tests for src/bridge/mt5Bridge.py.
No terminal, no network, no orders - the MetaTrader5 module is mocked.
Run from F:\\aitradingagent:  venv\\Scripts\\python.exe -m pytest tests\\test_mt5_bridge.py -q
(or: venv\\Scripts\\python.exe tests\\test_mt5_bridge.py)
"""
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["MT5_LOGIN"] = "12345"
os.environ["MT5_PASSWORD"] = "test-pass"
os.environ["MT5_SERVER"] = "Test-Server"
os.environ.pop("MT5_ALLOW_LIVE", None)

from src.bridge import mt5Bridge as mt5b  # noqa: E402


def make_fake_mt5(trade_mode=0, tick_bid=1.1000, tick_ask=1.1002):
    fake = types.SimpleNamespace()
    fake.TIMEFRAME_M1 = 1; fake.TIMEFRAME_M5 = 5; fake.TIMEFRAME_M15 = 15
    fake.TIMEFRAME_M30 = 30; fake.TIMEFRAME_H1 = 60; fake.TIMEFRAME_H4 = 240
    fake.TIMEFRAME_D1 = 1440
    fake.TRADE_ACTION_DEAL = 1
    fake.ORDER_TYPE_BUY = 0; fake.ORDER_TYPE_SELL = 1
    fake.ORDER_FILLING_FOK = 2
    fake.TRADE_RETCODE_DONE = 10009

    account = types.SimpleNamespace(login=12345, server="Test-Server", trade_mode=trade_mode,
                                     balance=1000.0, equity=1000.0, currency="USD", leverage=30)

    fake.initialize = MagicMock(return_value=True)
    fake.account_info = MagicMock(return_value=account)
    fake.shutdown = MagicMock()
    fake.last_error = MagicMock(return_value=(0, "no error"))

    tick = types.SimpleNamespace(bid=tick_bid, ask=tick_ask)
    fake.symbol_info_tick = MagicMock(return_value=tick)

    rate = {"time": 1758886800, "open": 1.10, "high": 1.11, "low": 1.09, "close": 1.105, "tick_volume": 500}
    fake.copy_rates_from_pos = MagicMock(return_value=[rate])

    order_result = types.SimpleNamespace(retcode=10009, comment="done", _asdict=lambda: {"retcode": 10009})
    fake.order_send = MagicMock(return_value=order_result)

    return fake, account


class TestMT5Bridge(unittest.TestCase):
    def setUp(self):
        os.environ.pop("MT5_ALLOW_LIVE", None)

    def test_missing_credentials_raises(self):
        old = os.environ.pop("MT5_LOGIN")
        try:
            with self.assertRaisesRegex(mt5b.MT5Error, "MT5_LOGIN"):
                mt5b.connect()
        finally:
            os.environ["MT5_LOGIN"] = old

    def test_get_candles_demo(self):
        fake, _ = make_fake_mt5(trade_mode=0)
        mt5b._mt5 = lambda: fake
        candles = mt5b.get_candles("EURUSD", "1h", 3)
        self.assertEqual(len(candles), 1)
        self.assertEqual(candles[0]["close"], 1.105)
        self.assertEqual(candles[0]["timestamp"], 1758886800000)

    def test_get_price(self):
        fake, _ = make_fake_mt5()
        mt5b._mt5 = lambda: fake
        px = mt5b.get_price("EURUSD")
        self.assertAlmostEqual(px["mid"], 1.1001)

    def test_order_without_stop_loss_refused(self):
        fake, _ = make_fake_mt5()
        mt5b._mt5 = lambda: fake
        with self.assertRaisesRegex(mt5b.MT5Error, "stop loss"):
            mt5b.place_market_order("EURUSD", "BUY", 0.1, sl_price=0)

    def test_order_wrong_side_stop_refused(self):
        fake, _ = make_fake_mt5(tick_bid=1.1000, tick_ask=1.1002)
        mt5b._mt5 = lambda: fake
        with self.assertRaisesRegex(mt5b.MT5Error, "wrong side"):
            mt5b.place_market_order("EURUSD", "BUY", 0.1, sl_price=1.20)

    def test_demo_order_dry_run(self):
        fake, _ = make_fake_mt5(trade_mode=0)
        mt5b._mt5 = lambda: fake
        r = mt5b.place_market_order("EURUSD", "BUY", 0.1, sl_price=1.09, dry_run=True)
        self.assertTrue(r["dryRun"])
        self.assertFalse(r["is_live"])
        fake.order_send.assert_not_called()

    def test_live_account_blocked_without_flag(self):
        fake, _ = make_fake_mt5(trade_mode=2)  # ACCOUNT_TRADE_MODE_REAL
        mt5b._mt5 = lambda: fake
        with self.assertRaisesRegex(mt5b.MT5Error, "LIVE/real"):
            mt5b.place_market_order("EURUSD", "BUY", 0.1, sl_price=1.09)
        fake.order_send.assert_not_called()

    def test_live_account_blocked_by_live_gate_even_with_flag(self):
        fake, _ = make_fake_mt5(trade_mode=2)
        mt5b._mt5 = lambda: fake
        os.environ["MT5_ALLOW_LIVE"] = "true"
        try:
            mt5b._live_gate_status = lambda: {"passed": False, "trades": 3, "winRate": 0.5}
            with self.assertRaisesRegex(mt5b.MT5Error, "Live gate not passed"):
                mt5b.place_market_order("EURUSD", "BUY", 0.1, sl_price=1.09)
            fake.order_send.assert_not_called()
        finally:
            os.environ.pop("MT5_ALLOW_LIVE", None)

    def test_demo_order_placed_when_valid(self):
        fake, _ = make_fake_mt5(trade_mode=0)
        mt5b._mt5 = lambda: fake
        r = mt5b.place_market_order("EURUSD", "BUY", 0.1, sl_price=1.09, tp_price=1.15)
        self.assertEqual(r["order"]["retcode"], 10009)
        fake.order_send.assert_called_once()


if __name__ == "__main__":
    unittest.main()
