"""
tests/test_strategy_evidence.py
Checks the 2026-09-24 evidence fix: no invented win rates, gate driven by measured results.

Run from F:\\aitradingagent:
    python -m pytest tests/test_strategy_evidence.py -q
"""
import json
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from orchestrator import strategy_evidence as se  # noqa: E402
from orchestrator import luxalgo_strategy_learner as lx  # noqa: E402


def _returns(n_win, win, n_loss, loss):
    return [win] * n_win + [loss] * n_loss


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    """Point every learner/evidence path at a temp folder so real files are never touched."""
    data, strat, sent = tmp_path / "data", tmp_path / "strategy", tmp_path / "sent"
    for d in (data, strat, sent):
        d.mkdir()
    monkeypatch.setattr(lx, "DATA_DIR", data)
    monkeypatch.setattr(lx, "STRATEGY_DIR", strat)
    monkeypatch.setattr(lx, "SENTIMENT_DIR", sent)
    monkeypatch.setattr(lx, "MEMORY_PATH", strat / "strategy_memory.json")
    monkeypatch.setattr(lx, "LEARNED_STRATEGIES_PATH", data / "learned_strategies.json")
    monkeypatch.setattr(lx, "CREDIBILITY_PATH", sent / "channel_credibility.json")
    monkeypatch.setattr(lx, "SENTIMENT_CACHE_PATH", data / "youtube_sentiment_cache.json")
    monkeypatch.setattr(lx, "TRANSCRIPT_CACHE_PATH", data / "youtube_transcripts_cache.json")
    monkeypatch.setattr(se, "DEFAULT_STORE_PATH", data / "backtest_evidence.json")
    monkeypatch.setattr(se.EvidenceStore.__init__, "__defaults__", (data / "backtest_evidence.json",))
    return tmp_path


def test_stats_from_returns():
    s = se.stats_from_returns(_returns(3, 2.0, 1, -1.0))
    assert s["trades"] == 4 and s["wins"] == 3
    assert s["profit_factor"] == 6.0
    assert s["expectancy_pct"] == 1.25


def test_gate_unverified_without_evidence():
    g = se.evaluate_gate(None)
    assert g["passed"] is False and g["status"] == se.STATUS_UNVERIFIED


def test_gate_rejects_small_sample_even_if_profitable():
    ev = se.from_returns(_returns(8, 3.0, 2, -1.0), "k", "ETH/USDT", "2h", "test", fees_included=True,
                         oos_profit_factor=1.5, max_drawdown_pct=5)
    g = se.evaluate_gate(ev)
    assert not g["passed"] and any("trades" in r for r in g["reasons"])


def test_gate_passes_low_winrate_trend_system():
    # ~13% win rate but big winners: the shape of the validated ETH EMA/VWAP edge
    ev = se.from_returns(_returns(20, 9.0, 130, -1.0), "k", "ETH/USDT", "2h", "test", fees_included=True,
                         oos_profit_factor=1.27, max_drawdown_pct=14)
    g = se.evaluate_gate(ev)
    assert g["passed"], g["reasons"]
    assert g["status"] == se.STATUS_PAPER


def test_gate_requires_out_of_sample():
    ev = se.from_returns(_returns(60, 3.0, 60, -1.0), "k", "BTC/USDT", "2h", "test", fees_included=True,
                         max_drawdown_pct=10)
    assert not se.evaluate_gate(ev)["passed"]


def test_js_backtest_conversion_real_sample():
    bt = {"symbol": "BTC/USDT", "timeframe": "15m", "totalTrades": 2, "winRate": 0, "profitFactor": 0,
          "netProfitPct": -1.36, "maxDrawdownPct": 1.36,
          "trades": [{"pnlPct": -0.42, "pnlUsd": -0.83, "entryTime": "2026-08-29T05:15:00Z"},
                     {"pnlPct": -0.5, "pnlUsd": -1.0, "entryTime": "2026-08-29T07:15:00Z"}]}
    ev = se.from_js_backtest(bt, "smc_luxalgo_5x")
    assert ev.trades == 2 and ev.wins == 0 and ev.profit_factor == 0.0
    assert ev.period_start == "2026-08-29T05:15:00Z"
    assert se.from_js_backtest({"totalTrades": 0}, "x") is None


def test_freqtrade_import():
    payload = {"strategy": {"MyStrat": {"timeframe": "1h", "backtest_start": "2024-01-01", "backtest_end": "2025-01-01",
               "max_drawdown_account": 0.12,
               "trades": [{"pair": "ETH/USDT", "profit_ratio": 0.03}, {"pair": "ETH/USDT", "profit_ratio": -0.01}]}}}
    evs = se.from_freqtrade_result(payload, "my_key", oos=True)
    assert len(evs) == 1 and evs[0].fees_included and evs[0].max_drawdown_pct == 12.0
    assert evs[0].oos_profit_factor == 3.0


def test_learner_has_no_invented_win_rate(sandbox):
    agent = lx.LuxAlgoStrategyLearnerAgent()
    s = agent.learn_and_generate_strategy(strategy_type="luxalgo_smc", symbol="BTC/USDT")
    assert s["target_win_rate_pct"] is None
    assert s["gate_68_met"] is False
    assert s["status"] == se.STATUS_UNVERIFIED
    assert "NOT MEASURED" in s["pinescript_code"]
    mem = json.loads(lx.MEMORY_PATH.read_text())
    assert mem["learnedStrategies"][0]["winRate"] is None
    for base in lx.LUXALGO_KNOWLEDGE_BASE.values():
        assert "target_win_rate_pct" not in base


def test_learner_uses_measured_evidence(sandbox):
    agent = lx.LuxAlgoStrategyLearnerAgent()
    ev = se.from_returns(_returns(60, 3.0, 60, -1.0), "luxalgo_smc", "ETH/USDT", "15m", "test",
                         fees_included=True, oos_profit_factor=1.4, max_drawdown_pct=10)
    agent.evidence.record(ev)
    s = agent.learn_and_generate_strategy(strategy_type="luxalgo_smc", symbol="ETH/USDT")
    assert s["target_win_rate_pct"] == 50.0
    assert s["gate_68_met"] is True and s["status"] == se.STATUS_PAPER


def test_paid_templates_flagged(sandbox):
    s = lx.LuxAlgoStrategyLearnerAgent().learn_and_generate_strategy(strategy_type="luxalgo_oscillator")
    assert s["requires_paid_indicator"] is True


def test_sentiment_no_transcript_is_neutral(sandbox):
    agent = lx.LuxAlgoStrategyLearnerAgent()
    feed = agent.source_all_subscription_alpha()
    assert feed["active_bias"] == "HOLD"
    assert feed["overall_confidence"] == 0.0
    assert feed["channels_with_real_data"] == 0
    assert all(c["data_quality"] == "no_real_transcript" for c in feed["channels"])
    empty = agent.gauge_transcript_sentiment("")
    assert empty["bias_signal"] == "HOLD" and empty["confidence"] == 0.0


def test_credibility_starts_neutral(sandbox):
    cred = lx.LuxAlgoStrategyLearnerAgent().credibility
    assert all(v["trades"] == 0 and v["accuracy"] is None and v["weight"] == 1.0 for v in cred.values())


def test_old_records_are_downgraded():
    old = {"title": "x", "target_win_rate_pct": 76.5, "status": "ACTIVE_PRODUCTION_STRATEGY"}
    n = lx._normalize_strategy(old)
    assert n["target_win_rate_pct"] is None and n["status"] == se.STATUS_UNVERIFIED and n["gate_68_met"] is False


def test_migration_on_copy_of_real_files(sandbox):
    src = ROOT / "data" / "learned_strategies.json"
    mem = ROOT / "strategy" / "strategy_memory.json"
    if not (src.exists() and mem.exists()):
        pytest.skip("real files not present")
    shutil.copy(src, lx.LEARNED_STRATEGIES_PATH)
    shutil.copy(mem, lx.MEMORY_PATH)
    before_trades = json.loads(mem.read_text()).get("tradeHistory")
    rep = lx.migrate_existing()
    assert len(rep["backups"]) == 2
    out = json.loads(lx.LEARNED_STRATEGIES_PATH.read_text())
    assert all(s["status"] != "ACTIVE_PRODUCTION_STRATEGY" for s in out)
    assert not any(s["target_win_rate_pct"] == 76.5 for s in out)
    m = json.loads(lx.MEMORY_PATH.read_text())
    assert all(e["winRate"] is None for e in m["learnedStrategies"])
    assert m.get("tradeHistory") == before_trades
