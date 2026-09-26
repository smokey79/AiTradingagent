"""
pybacktest/tests/test_pybacktest.py - offline tests (no network).
Run from F:\\aitradingagent:   python -m unittest pybacktest.tests.test_pybacktest -v
"""
import math
import random
import unittest

from pybacktest import engine, indicators as ind, metrics
from pybacktest.strategies import lab_signals
from signals.supertrend_ai import supertrend_ai, latest_signal, percentile_linear, _kmeans3

H = 3_600_000


def synthetic(n=900, seed=1):
    """Down, up, down legs with noise - enough to produce crossings both ways."""
    rnd = random.Random(seed)
    px, out = 100.0, []
    for i in range(n):
        drift = -0.12 if i < 300 else (0.25 if i < 600 else -0.25)
        o = px
        px = max(1.0, px + drift + rnd.gauss(0, 0.4))
        out.append({"timestamp": 1_700_000_000_000 + i * H, "open": o, "high": max(o, px) + abs(rnd.gauss(0, 0.2)),
                    "low": min(o, px) - abs(rnd.gauss(0, 0.2)), "close": px, "volume": 10 + rnd.random()})
    return out


class Indicators(unittest.TestCase):
    def test_ema_sma_seed(self):
        e = ind.ema([1, 2, 3, 4, 5, 6], 3)
        self.assertIsNone(e[1]); self.assertEqual(e[2], 2); self.assertAlmostEqual(e[3], 3)

    def test_rma_and_atr(self):
        r = ind.rma([2, 2, 2, 4], 3)
        self.assertEqual(r[2], 2); self.assertAlmostEqual(r[3], (2 * 2 + 4) / 3)
        c = synthetic(50)
        self.assertTrue(all(v is None for v in ind.atr(c, 14)[:13]))

    def test_vwap_resets_daily(self):
        d = 86_400_000
        v = ind.vwap_daily([{"timestamp": 0, "close": 10, "volume": 1}, {"timestamp": H, "close": 20, "volume": 1},
                            {"timestamp": d, "close": 30, "volume": 1}])
        self.assertEqual(v, [10, 15, 30])

    def test_adx_range(self):
        a = [x for x in ind.adx(synthetic(300), 14) if x is not None]
        self.assertTrue(a and all(0 <= x <= 100 for x in a))


class Engine(unittest.TestCase):
    def test_fees_and_flip(self):
        c = [{"timestamp": i * H, "open": p, "high": p + 1, "low": p - 1, "close": p, "volume": 1} for i, p in enumerate([100, 110, 121])]
        sig = {"long": [True, False, False], "short": [False, False, True], "atr": [None] * 3, "atr_mult": None}
        t = engine.run(c, sig)
        self.assertEqual(len(t), 1)
        self.assertAlmostEqual(t[0]["pct"], 21 - 0.1)
        self.assertEqual(t[0]["reason"], "FLIP")

    def test_stop_fills_at_open_on_gap(self):
        c = [{"timestamp": 0, "open": 100, "high": 100, "low": 100, "close": 100, "volume": 1},
             {"timestamp": H, "open": 90, "high": 91, "low": 85, "close": 88, "volume": 1}]
        sig = {"long": [True, False], "short": [False, False], "atr": [5, 5], "atr_mult": 1.0}
        t = engine.run(c, sig)
        self.assertEqual(t[0]["exit"], 90)  # stop 95 gapped through -> filled at the open
        self.assertEqual(t[0]["reason"], "STOP")

    def test_lab_strategy_trades(self):
        c = synthetic()
        t = engine.run(c, lab_signals(c, "EMA_ADX20_ATR25"))
        self.assertGreater(len(t), 0)


class Metrics(unittest.TestCase):
    def test_pf_and_resim(self):
        self.assertEqual(metrics.pct_pf([2, -1]), 2.0)
        self.assertAlmostEqual(metrics.resim([10, -10], 1.0)["net_pct"], -1.0)

    def test_verdict(self):
        s = {"trades": 150, "pct_pf": 1.3, "oos_trades": 40, "oos_pf": 1.2, "dd15_pct": 10}
        self.assertTrue(metrics.cell_verdict(s)["pass"])
        self.assertFalse(metrics.cell_verdict({**s, "oos_pf": 1.0})["pass"])


class SuperTrendAI(unittest.TestCase):
    def test_percentile_matches_linear(self):
        self.assertEqual(percentile_linear([1, 2, 3, 4], 50), 2.5)
        self.assertAlmostEqual(percentile_linear([1, 2, 3, 4], 25), 1.75)

    def test_kmeans_orders_clusters(self):
        perf, fac = _kmeans3([0, 0.1, 5, 5.2, 10, 10.1], [1, 2, 3, 4, 5, 6], 100)
        self.assertEqual(fac[2], [5, 6]); self.assertEqual(fac[0], [1, 2])

    def test_flips_both_ways(self):
        rows = supertrend_ai(synthetic())
        sigs = [r["signal"] for r in rows if r["signal"]]
        self.assertIn("BUY", sigs); self.assertIn("SELL", sigs)
        self.assertTrue(all(1 <= r["target_factor"] <= 5 for r in rows if r["target_factor"] is not None))

    def test_no_repainting(self):
        c = synthetic(600)
        full = supertrend_ai(c)
        part = supertrend_ai(c[:450])
        for a, b in zip(full[:450], part):
            self.assertEqual(a["signal"], b["signal"]); self.assertEqual(a["os"], b["os"])
            if a["ts"] is not None:
                self.assertTrue(math.isclose(a["ts"], b["ts"]))

    def test_latest_signal_shape(self):
        s = latest_signal(synthetic(400))
        self.assertIn(s["trend"], ("UP", "DOWN"))


if __name__ == "__main__":
    unittest.main()
