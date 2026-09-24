"""
tests/test_data_sourcer_real.py
Checks that the Data Sourcer reports only measured numbers (2026-09-24 rewrite).

Run from F:\\aitradingagent:
    python -m pytest tests/test_data_sourcer_real.py -q
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from orchestrator import data_sourcer_agent as ds  # noqa: E402


@pytest.fixture
def paths(tmp_path, monkeypatch):
    monkeypatch.setattr(ds, "DB_PATH", tmp_path / "trading.db")
    monkeypatch.setattr(ds, "LEDGER_PATH", tmp_path / "trade_ledger.json")
    monkeypatch.setattr(ds, "MEMORY_PATH", tmp_path / "strategy_memory.json")
    return tmp_path


def _write_ledger(path, wins, losses, extra=()):
    rows = [{"outcome": "WIN", "pnlUsd": 2.0}] * wins + [{"outcome": "LOSS", "pnlUsd": -1.0}] * losses + list(extra)
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n")


NOW = datetime.now(timezone.utc).isoformat()
GOOD_MARKET = {"tickers": [{"symbol": "BTC/USDT"}], "order_book": {"bids": [[1, 1]], "asks": [[2, 1]]}, "fetched_at": NOW}


def test_no_trades_means_no_win_rate(paths):
    s = ds.DataSourcerAgent().evaluate_feeds()
    assert s["rolling_win_rate"] is None
    assert s["total_trades_analyzed"] == 0
    assert s["gate_68_met"] is False and s["gate_applicable"] is False
    assert "COLLECTING_SAMPLE" in s["gate_status"]
    assert s["win_rate_for_risk_model"] == ds.RISK_PRIOR_WIN_RATE and s["risk_model_win_rate_is_prior"]


def test_no_feed_data_scores_zero(paths):
    s = ds.DataSourcerAgent().evaluate_feeds()
    for key, f in s["feed_scores"].items():
        if key != "luxalgo_learning":
            assert f["score"] == 0.0 and f["status"] == "NO_DATA", key
        assert f["accuracy_pct"] is None and f["contribution_to_pnl"] is None
    assert s["composite_score"] < 20


def test_real_feed_scores_from_payload(paths):
    f = ds.score_feed("ccxt_orderbook", GOOD_MARKET)
    assert f["score"] == 100.0 and f["completeness_pct"] == 100.0
    partial = ds.score_feed("ccxt_orderbook", {"tickers": [1], "fetched_at": NOW})
    assert 30 < partial["score"] < 40


def test_stale_and_fallback_feeds(paths):
    stale = ds.score_feed("volatility_regime", {"regime": "X", "fetched_at": "2020-01-01T00:00:00+00:00"})
    assert stale["score"] == 0.0
    fb = ds.score_feed("sosovalue_etf", {"btc_etf": {"total_net_flow_usd_m": 1, "is_fallback": True},
                                         "eth_etf": {"total_net_flow_usd_m": 2, "is_fallback": True}})
    assert fb["score"] == 0.0 and "FALLBACK" in fb["status"]
    fb2 = ds.score_feed("volatility_regime", {"regime": "NORMAL", "is_fallback": True})
    assert fb2["available"] is False


def test_real_ledger_win_rate_and_gate(paths):
    _write_ledger(paths / "trade_ledger.json", 1, 6,
                  extra=[{"outcome": "WIN", "simulated": True, "pnlUsd": 50}, {"outcome": "PENDING"}])
    s = ds.DataSourcerAgent().evaluate_feeds(market_data=GOOD_MARKET)
    assert s["total_trades_analyzed"] == 7 and s["wins"] == 1   # simulated/pending ignored
    assert s["rolling_win_rate_pct"] == "14.3%"
    assert s["gate_applicable"] is False                           # 7 < 250
    assert s["win_rate_source"] == "trade_ledger"


def test_gate_met_and_failed_after_250(paths):
    _write_ledger(paths / "trade_ledger.json", 175, 75)             # 70% over 250
    s = ds.DataSourcerAgent().evaluate_feeds(market_data=GOOD_MARKET)
    assert s["gate_applicable"] and s["gate_68_met"] and s["gate_status"] == "MET"
    assert s["win_rate_for_risk_model"] == 0.7 and not s["risk_model_win_rate_is_prior"]
    _write_ledger(paths / "trade_ledger.json", 163, 87)             # 65.2% over 250
    s = ds.DataSourcerAgent().evaluate_feeds(market_data=GOOD_MARKET)
    assert s["gate_status"] == "FAILED" and s["sourcer_verdict"] == "HOLD"
    _write_ledger(paths / "trade_ledger.json", 200, 49)             # 80% but only 249 trades
    s = ds.DataSourcerAgent().evaluate_feeds(market_data=GOOD_MARKET)
    assert s["gate_applicable"] is False and not s["gate_68_met"]
    _write_ledger(paths / "trade_ledger.json", 163, 87)
    s = ds.DataSourcerAgent().evaluate_feeds(market_data=GOOD_MARKET)
    assert s["gate_status"] == "FAILED" and s["sourcer_verdict"] == "HOLD"


def test_prompt_injection_says_not_measured(paths):
    agent = ds.DataSourcerAgent()
    text = agent.build_prompt_injection(agent.evaluate_feeds())
    assert "not measured" in text and "91.5" not in text and "+32.4%" not in text
