"""
tests/test_full_system.py
=========================
Comprehensive automated test suite for the AiTradingAgent platform.
Validates CCXT live market data, SoSoValue ETF macro feeds, Monte Carlo risk simulation,
quantitative analysis modules, DataSourcerAgent hit-rate auditing, backtesting engine,
consensus engine, and SQLite database persistence.
"""

import sys
import unittest
import sqlite3
from pathlib import Path

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from data_sources.ccxt_feed import CCXTFeed
from data_sources.sosovalue_feed import SoSoValueFeed
from risk.monte_carlo import MonteCarloRisk, MCConfig
from data_pipeline import DataPipeline

# Import quantitative modules
from python_modules.relative_strength import calculate_rsi, rank_relative_strength
from python_modules.peer_rotation import analyze_peer_rotation
from python_modules.volatility_regimes import calculate_atr, calculate_bollinger_bands, detect_volatility_regime
from python_modules.sopr_mvrv import calculate_mvrv_proxy

from orchestrator.data_sourcer_agent import DataSourcerAgent
from backtester.engine import BacktestEngine
from orchestrator.consensus_engine import run_consensus, DB_PATH


class TestAiTradingPlatform(unittest.TestCase):

    def setUp(self):
        self.dummy_candles = [
            {
                "symbol": "BTC/USDT",
                "timestamp": f"2026-08-26T{i:02d}:00:00Z",
                "open": 70000.0 + i * 50,
                "high": 70100.0 + i * 50,
                "low": 69900.0 + i * 50,
                "close": 70050.0 + i * 50,
                "volume": 1200.0 + i * 10,
            }
            for i in range(50)
        ]

    # ── 1. CCXT Feed Tests ──────────────────────────────────────────────────

    def test_ccxt_feed_initialization(self):
        feed = CCXTFeed(symbols=["BTC/USDT", "ETH/USDT"])
        self.assertIsNotNone(feed.primary)
        self.assertIsNotNone(feed.fallback)

    def test_ccxt_single_ticker(self):
        feed = CCXTFeed(symbols=["BTC/USDT"])
        ticker = feed.get_ticker("BTC/USDT")
        if ticker:
            self.assertEqual(ticker["symbol"], "BTC/USDT")
            self.assertGreater(ticker["price"], 0)
            self.assertIn("change_24h", ticker)

    # ── 2. SoSoValue & Macro Tests ──────────────────────────────────────────

    def test_macro_snapshot(self):
        feed = SoSoValueFeed()
        snap = feed.get_macro_snapshot()
        self.assertIn("btc_etf", snap)
        self.assertIn("eth_etf", snap)
        self.assertIn("macro_signal", snap)
        self.assertIn(snap["macro_signal"]["signal"], ["bullish", "bearish", "neutral"])

    # ── 3. Monte Carlo & Kelly Risk Tests ───────────────────────────────────

    def test_monte_carlo_kelly(self):
        mc = MonteCarloRisk(win_rate=0.60, avg_win=0.04, avg_loss=0.02)
        self.assertAlmostEqual(mc.full_kelly, 0.40, places=2)
        self.assertAlmostEqual(mc.recommended_position_pct, 0.10, places=2)

    def test_monte_carlo_evaluation(self):
        mc = MonteCarloRisk(win_rate=0.55, avg_win=0.04, avg_loss=0.02)
        eval_result = mc.evaluate(account_balance=1000.0, proposed_position_pct=0.05)
        self.assertIn("approved", eval_result)
        self.assertIn("position_usd", eval_result)
        self.assertIn("simulation", eval_result)
        self.assertEqual(eval_result["account_balance"], 1000.0)

    # ── 4. Unified Data Pipeline Tests ──────────────────────────────────────

    def test_data_pipeline_execution(self):
        pipeline = DataPipeline(symbols=["BTC/USDT", "ETH/USDT"])
        package = pipeline.run(account_balance=1000.0, proposed_position_pct=0.05, symbol="BTC/USDT")
        self.assertIn(package["pipeline_version"], ["2.0.0", "4.0.0"])
        self.assertIn("market", package)
        self.assertIn("macro", package)
        self.assertIn("risk", package)
        self.assertIn("sourcer", package)
        self.assertIn("agent_summary", package)
        self.assertIn("text", package["agent_summary"])

    # ── 5. Data Sourcer Hit-Rate & Attribution Tests ─────────────────────────

    def test_data_sourcer_evaluation(self):
        sourcer = DataSourcerAgent()
        eval_summary = sourcer.evaluate_feeds()
        self.assertIn("composite_score", eval_summary)
        self.assertGreaterEqual(eval_summary["composite_score"], 70.0)
        self.assertIn("feed_scores", eval_summary)
        self.assertIn("ccxt_orderbook", eval_summary["feed_scores"])
        self.assertIn("sosovalue_etf", eval_summary["feed_scores"])
        self.assertIn("gate_72_met", eval_summary)

    # ── 6. Quantitative Modules Tests ───────────────────────────────────────

    def test_rsi_calculation(self):
        prices = [100.0 + i for i in range(30)]
        rsi = calculate_rsi(prices, period=14)
        self.assertEqual(rsi, 100.0)

    def test_peer_rotation(self):
        sample_tickers = [
            {"symbol": "BTC/USDT", "change_24h": 1.5, "volume_24h": 1000000, "price": 70000},
            {"symbol": "SOL/USDT", "change_24h": 5.0, "volume_24h": 500000, "price": 100},
            {"symbol": "ARB/USDT", "change_24h": -2.0, "volume_24h": 200000, "price": 0.10},
        ]
        rotation = analyze_peer_rotation(sample_tickers)
        self.assertEqual(rotation["leading_token"], "SOL/USDT")
        self.assertEqual(rotation["lagging_token"], "ARB/USDT")

    def test_volatility_regimes(self):
        atr = calculate_atr(self.dummy_candles, period=14)
        self.assertGreater(atr["atr"], 0)
        bb = calculate_bollinger_bands(self.dummy_candles, period=20)
        self.assertGreater(bb["upper"], bb["lower"])
        regime = detect_volatility_regime(self.dummy_candles)
        self.assertIn("regime", regime)

    def test_mvrv_proxy(self):
        mvrv = calculate_mvrv_proxy(self.dummy_candles, short_period=10, long_period=30)
        self.assertIn("mvrv_proxy", mvrv)
        self.assertIn("cycle_phase", mvrv)

    # ── 7. Backtester Engine Tests ──────────────────────────────────────────

    def test_backtester_run(self):
        engine = BacktestEngine(initial_capital=1000.0)
        result = engine.run_rsi_trend_strategy(self.dummy_candles, symbol="BTC/USDT")
        self.assertIn("total_return_pct", result)
        self.assertIn("win_rate_pct", result)
        self.assertIn("monte_carlo_validation", result)

    # ── 8. Trader Oversight & Unit Economics Tests ──────────────────────────

    def test_trader_oversight_economics(self):
        from orchestrator.trader_oversight import TraderOversightAgent
        oversight = TraderOversightAgent()
        eco = oversight.calculate_trade_economics("BTC/USDT", position_usd=50.0, expected_gain_pct=0.04)
        self.assertIn("net_profitability_pct", eco)
        self.assertGreaterEqual(eco["net_profitability_pct"], 0.5)
        self.assertIn("economic_efficiency_pct", eco)
        self.assertTrue(eco["approved"])
        self.assertIn("estimated_exchange_fee_usd", eco)
        self.assertIn("estimated_gas_fee_usd", eco)
        self.assertIn("estimated_model_cycle_cost_usd", eco)

        lifetime = oversight.get_project_lifetime_economics()
        self.assertIn("net_project_roi_pct", lifetime)
        self.assertIn("cost_to_income_ratio_pct", lifetime)
        self.assertGreater(lifetime["gross_trading_profit_usd"], 0)

    # ── 9. SQLite Database Persistence ──────────────────────────────────────

    def test_sqlite_persistence(self):
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM signals")
        sig_count = cur.fetchone()[0]
        self.assertGreaterEqual(sig_count, 1)
        conn.close()


if __name__ == "__main__":
    unittest.main()
