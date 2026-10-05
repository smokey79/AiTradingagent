"""
orchestrator/strategy_evidence.py
=================================
Measured-evidence registry and promotion gate for learned strategies.

Why this exists
---------------
Before 2026-09-24 the LuxAlgo learner stamped every strategy with hard-coded
win rates (76.5 %, 73 %, 71.5 %) and marked the 68 % gate as "met" from those
constants, so strategies "passed" without a single trade. This module replaces
that with numbers that come only from real backtests or paper trades.

What it does
------------
1. Converts backtest output into one `Evidence` record. Supported inputs:
   - the JS StrategyLearningAgent backtest dict (totalTrades, winRate, profitFactor, trades[] ...)
   - Freqtrade backtest result files (.json or .zip from user_data/backtest_results)
   - any plain list of per-trade % returns (e.g. the lab's get_trades output)
2. Stores records in data/backtest_evidence.json (append-only, newest first).
3. Applies a promotion gate built on profit factor, expectancy, sample size,
   drawdown and out-of-sample results, not on raw win rate. Trend systems with
   low win rates (your validated ETH EMA/VWAP edge wins ~13 %) can pass; small
   or in-sample-only samples cannot.

The gate never promotes anything to live trading. The best possible status is
PAPER_CANDIDATE. Moving to live stays a manual decision.

Gate thresholds (override in your .env, no code change needed):
    EVIDENCE_MIN_TRADES      default 100
    EVIDENCE_MIN_PF          default 1.20   (profit factor after fees)
    EVIDENCE_MIN_OOS_PF      default 1.10   (out-of-sample profit factor)
    EVIDENCE_MAX_DD_PCT      default 25.0   (max drawdown %)
    EVIDENCE_REQUIRE_OOS     default 1      (1 = out-of-sample result required)

Usage
-----
    from orchestrator.strategy_evidence import EvidenceStore, evaluate_gate, from_js_backtest
    store = EvidenceStore()
    ev = from_js_backtest(bt_dict, strategy_key="luxalgo_smc", source="strategyLearningAgent")
    store.record(ev)
    verdict = evaluate_gate(store.best_for("luxalgo_smc", "BTC/USDT", "15m"))

Command line (from F:\\aitradingagent):
    python -m orchestrator.strategy_evidence --import-freqtrade <file> --key <strategy_key>
    python -m orchestrator.strategy_evidence --list
"""

from __future__ import annotations

import io
import json
import os
import sys
import zipfile
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STORE_PATH = PROJECT_ROOT / "data" / "backtest_evidence.json"

STATUS_UNVERIFIED = "UNVERIFIED_RESEARCH"
STATUS_FAILED = "FAILED_EVIDENCE_GATE"
STATUS_PAPER = "PAPER_CANDIDATE"


# ── Gate configuration ───────────────────────────────────────────────────────

def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _load_realism_bar() -> Dict[str, Any]:
    """Promotion bar from config/realism.json (same file the Node side reads). Falls back to the same values."""
    fallback = {"min_oos_trades": 60, "min_profit_factor": 1.3, "min_oos_profit_factor": 1.3,
                "max_drawdown_pct": 20, "require_fees_included": True}
    try:
        import json as _json
        from pathlib import Path as _Path
        p = _Path(__file__).resolve().parents[1] / "config" / "realism.json"
        return {**fallback, **_json.loads(p.read_text(encoding="utf-8")).get("promotion", {})}
    except Exception:
        return fallback


_REALISM_BAR = _load_realism_bar()


@dataclass
class GateConfig:
    # 2026-10-03 promotion bar (config/realism.json via core.realism): >= 60 out-of-sample trades,
    # profit factor above 1.3, drawdown under 20%, fees/slippage included. Was PF 1.20 / OOS PF 1.10 / DD 25.
    # The EVIDENCE_* environment variables still override.
    min_trades: int = field(default_factory=lambda: int(_env_float("EVIDENCE_MIN_TRADES", 100)))
    min_oos_trades: int = field(default_factory=lambda: int(_env_float("EVIDENCE_MIN_OOS_TRADES", _REALISM_BAR["min_oos_trades"])))
    min_profit_factor: float = field(default_factory=lambda: _env_float("EVIDENCE_MIN_PF", _REALISM_BAR["min_profit_factor"]))
    min_oos_profit_factor: float = field(default_factory=lambda: _env_float("EVIDENCE_MIN_OOS_PF", _REALISM_BAR["min_oos_profit_factor"]))
    max_drawdown_pct: float = field(default_factory=lambda: _env_float("EVIDENCE_MAX_DD_PCT", _REALISM_BAR["max_drawdown_pct"]))
    require_oos: bool = field(default_factory=lambda: _env_float("EVIDENCE_REQUIRE_OOS", 1) >= 1)
    require_fees: bool = field(default_factory=lambda: bool(_REALISM_BAR["require_fees_included"]))


# ── Evidence record ──────────────────────────────────────────────────────────

@dataclass
class Evidence:
    strategy_key: str
    symbol: str
    timeframe: str
    source: str                           # e.g. "freqtrade", "strategyLearningAgent", "tradingkit_lab", "paper"
    trades: int
    wins: int
    losses: int
    win_rate_pct: Optional[float]
    profit_factor: Optional[float]
    expectancy_pct: Optional[float]       # mean % return per trade
    net_profit_pct: Optional[float] = None
    max_drawdown_pct: Optional[float] = None
    oos_profit_factor: Optional[float] = None
    oos_trades: Optional[int] = None
    fees_included: bool = False
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    notes: str = ""
    recorded_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "Evidence":
        allowed = Evidence.__dataclass_fields__.keys()
        return Evidence(**{k: v for k, v in d.items() if k in allowed})


def _num(x: Any) -> Optional[float]:
    try:
        if x is None or x == "":
            return None
        return float(x)
    except (TypeError, ValueError):
        return None


def stats_from_returns(returns_pct: Iterable[float]) -> Dict[str, Optional[float]]:
    """Profit factor, expectancy and win stats from per-trade % returns."""
    r = [float(v) for v in returns_pct if _num(v) is not None]
    n = len(r)
    if n == 0:
        return {"trades": 0, "wins": 0, "losses": 0, "win_rate_pct": None, "profit_factor": None, "expectancy_pct": None}
    gains = sum(v for v in r if v > 0)
    losses_abs = -sum(v for v in r if v < 0)
    wins = sum(1 for v in r if v > 0)
    pf = (gains / losses_abs) if losses_abs > 0 else (float("inf") if gains > 0 else 0.0)
    return {
        "trades": n,
        "wins": wins,
        "losses": n - wins,
        "win_rate_pct": round(wins / n * 100, 2),
        "profit_factor": round(pf, 3) if pf != float("inf") else 999.0,
        "expectancy_pct": round(sum(r) / n, 4),
    }


# ── Converters ───────────────────────────────────────────────────────────────

def from_returns(returns_pct: Iterable[float], strategy_key: str, symbol: str, timeframe: str,
                 source: str, **extra: Any) -> Evidence:
    s = stats_from_returns(returns_pct)
    return Evidence(strategy_key=strategy_key, symbol=symbol, timeframe=timeframe, source=source,
                    trades=int(s["trades"]), wins=int(s["wins"]), losses=int(s["losses"]),
                    win_rate_pct=s["win_rate_pct"], profit_factor=s["profit_factor"],
                    expectancy_pct=s["expectancy_pct"], **extra)


def from_js_backtest(bt: Dict[str, Any], strategy_key: str, source: str = "strategyLearningAgent") -> Optional[Evidence]:
    """Convert the JS StrategyLearningAgent backtest dict. Returns None if it has no trades."""
    if not isinstance(bt, dict):
        return None
    trades = bt.get("trades") if isinstance(bt.get("trades"), list) else []
    symbol = bt.get("symbol") or "UNKNOWN"
    timeframe = bt.get("timeframe") or "UNKNOWN"
    if trades:
        ev = from_returns([t.get("pnlPct") for t in trades if isinstance(t, dict)],
                          strategy_key, symbol, timeframe, source)
        # Profit factor in USD is more reliable than in % when sizes differ.
        usd = [_num(t.get("pnlUsd")) for t in trades if isinstance(t, dict)]
        usd = [u for u in usd if u is not None]
        if usd:
            ev.profit_factor = stats_from_returns(usd)["profit_factor"]
        times = [t.get("entryTime") for t in trades if isinstance(t, dict) and t.get("entryTime")]
        ev.period_start, ev.period_end = (min(times), max(times)) if times else (None, None)
    else:
        total = int(_num(bt.get("totalTrades")) or 0)
        if total == 0:
            return None
        ev = Evidence(strategy_key=strategy_key, symbol=symbol, timeframe=timeframe, source=source,
                      trades=total, wins=int(_num(bt.get("winCount")) or 0), losses=int(_num(bt.get("lossCount")) or 0),
                      win_rate_pct=_num(bt.get("winRate")), profit_factor=_num(bt.get("profitFactor")),
                      expectancy_pct=None)
    ev.net_profit_pct = _num(bt.get("netProfitPct"))
    ev.max_drawdown_pct = _num(bt.get("maxDrawdownPct"))
    ev.fees_included = bool(bt.get("feesIncluded", False))
    return ev


def _load_freqtrade_payload(path: Path) -> Dict[str, Any]:
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as z:
            name = next(n for n in z.namelist() if n.endswith(".json") and "_config" not in n and "market_change" not in n)
            return json.load(io.TextIOWrapper(z.open(name), encoding="utf-8"))
    return json.loads(path.read_text(encoding="utf-8"))


def from_freqtrade_result(result: Any, strategy_key: str, strategy_name: Optional[str] = None,
                          oos: bool = False) -> List[Evidence]:
    """
    Convert a Freqtrade backtest result (path, or already-loaded dict) into one Evidence per pair.
    Freqtrade includes fees in profit_ratio, so fees_included=True.
    Set oos=True when the file is an out-of-sample (walk-forward) run: its profit factor is then
    stored as oos_profit_factor so it can be merged with the in-sample record.
    """
    payload = _load_freqtrade_payload(Path(result)) if not isinstance(result, dict) else result
    strategies = payload.get("strategy", {})
    if not strategies:
        return []
    name = strategy_name or next(iter(strategies))
    st = strategies.get(name, {})
    tf = st.get("timeframe") or "UNKNOWN"
    by_pair: Dict[str, List[float]] = {}
    for t in st.get("trades", []):
        pr = _num(t.get("profit_ratio"))
        if pr is not None:
            by_pair.setdefault(t.get("pair", "UNKNOWN"), []).append(pr * 100)
    out: List[Evidence] = []
    for pair, rets in by_pair.items():
        ev = from_returns(rets, strategy_key, pair, tf, "freqtrade",
                          fees_included=True,
                          period_start=st.get("backtest_start"), period_end=st.get("backtest_end"),
                          notes=f"freqtrade strategy {name}")
        dd = _num(st.get("max_drawdown_account"))
        ev.max_drawdown_pct = round(dd * 100, 2) if dd is not None else None
        if oos:
            ev.oos_profit_factor, ev.oos_trades = ev.profit_factor, ev.trades
            ev.notes += " (out-of-sample run)"
        out.append(ev)
    return out


# ── Store ────────────────────────────────────────────────────────────────────

class EvidenceStore:
    def __init__(self, path: Path = DEFAULT_STORE_PATH):
        self.path = Path(path)
        self.records: List[Evidence] = self._load()

    def _load(self) -> List[Evidence]:
        try:
            if self.path.exists():
                raw = json.loads(self.path.read_text(encoding="utf-8"))
                return [Evidence.from_dict(r) for r in raw if isinstance(r, dict)]
        except Exception:
            pass
        return []

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps([r.to_dict() for r in self.records], indent=2), encoding="utf-8")
        tmp.replace(self.path)

    def record(self, ev: Optional[Evidence]) -> Optional[Evidence]:
        if ev is None:
            return None
        self.records.insert(0, ev)
        self.save()
        return ev

    def find(self, strategy_key: str, symbol: Optional[str] = None, timeframe: Optional[str] = None) -> List[Evidence]:
        return [r for r in self.records
                if r.strategy_key == strategy_key
                and (symbol is None or r.symbol == symbol)
                and (timeframe is None or r.timeframe == timeframe)]

    def best_for(self, strategy_key: str, symbol: Optional[str] = None, timeframe: Optional[str] = None) -> Optional[Evidence]:
        """Largest sample wins; ties go to the newest record. Out-of-sample PF is merged in if recorded separately."""
        rows = self.find(strategy_key, symbol, timeframe)
        if not rows:
            return None
        best = max(rows, key=lambda r: (r.trades, r.recorded_at))
        if best.oos_profit_factor is None:
            oos = [r for r in rows if r.oos_profit_factor is not None and r is not best]
            if oos:
                latest = max(oos, key=lambda r: r.recorded_at)
                best = Evidence.from_dict({**best.to_dict(), "oos_profit_factor": latest.oos_profit_factor,
                                           "oos_trades": latest.oos_trades})
        return best


# ── Gate ─────────────────────────────────────────────────────────────────────

def evaluate_gate(ev: Optional[Evidence], cfg: Optional[GateConfig] = None) -> Dict[str, Any]:
    """
    Returns {passed, status, reasons, metrics}. No evidence -> UNVERIFIED (never passes).
    Win rate is reported but not gated: profit factor and expectancy decide.
    """
    cfg = cfg or GateConfig()
    if ev is None or ev.trades == 0:
        return {"passed": False, "status": STATUS_UNVERIFIED,
                "reasons": ["No measured backtest or paper-trade results recorded for this strategy."],
                "metrics": None}
    reasons: List[str] = []
    if ev.trades < cfg.min_trades:
        reasons.append(f"Only {ev.trades} trades (need {cfg.min_trades}).")
    if ev.profit_factor is None or not ev.profit_factor > cfg.min_profit_factor:
        reasons.append(f"Profit factor {ev.profit_factor} not above {cfg.min_profit_factor}.")
    if ev.expectancy_pct is not None and ev.expectancy_pct <= 0:
        reasons.append(f"Expectancy {ev.expectancy_pct}% per trade is not positive.")
    # 2026-10-03: drawdown must be KNOWN and under the bar (unknown used to pass silently).
    if ev.max_drawdown_pct is None or not ev.max_drawdown_pct < cfg.max_drawdown_pct:
        reasons.append(f"Max drawdown {ev.max_drawdown_pct}% not under {cfg.max_drawdown_pct}%.")
    if cfg.require_oos:
        if ev.oos_profit_factor is None:
            reasons.append("No out-of-sample (walk-forward) result recorded.")
        elif not ev.oos_profit_factor > cfg.min_oos_profit_factor:
            reasons.append(f"Out-of-sample profit factor {ev.oos_profit_factor} not above {cfg.min_oos_profit_factor}.")
        if ev.oos_trades is None or ev.oos_trades < cfg.min_oos_trades:
            reasons.append(f"Only {ev.oos_trades} out-of-sample trades (need {cfg.min_oos_trades}).")
    if cfg.require_fees and not ev.fees_included:
        reasons.append("Fees/slippage not confirmed as included.")  # blocking since 2026-10-03
    blocking = [r for r in reasons if not r.startswith("Warning:")]
    passed = not blocking
    return {"passed": passed, "status": STATUS_PAPER if passed else STATUS_FAILED,
            "reasons": reasons, "metrics": ev.to_dict()}


# ── CLI ──────────────────────────────────────────────────────────────────────

def _main(argv: List[str]) -> int:
    import argparse
    p = argparse.ArgumentParser(description="Record and inspect measured strategy evidence.")
    p.add_argument("--import-freqtrade", metavar="FILE", help="Freqtrade backtest result .json or .zip")
    p.add_argument("--key", help="Strategy key to file the results under, e.g. luxalgo_smc")
    p.add_argument("--strategy-name", help="Strategy class name inside the Freqtrade file (default: first)")
    p.add_argument("--oos", action="store_true", help="Mark the imported file as an out-of-sample run")
    p.add_argument("--list", action="store_true", help="List recorded evidence with gate verdicts")
    a = p.parse_args(argv)
    store = EvidenceStore()
    if a.import_freqtrade:
        if not a.key:
            p.error("--key is required with --import-freqtrade")
        evs = from_freqtrade_result(a.import_freqtrade, a.key, a.strategy_name, oos=a.oos)
        for ev in evs:
            store.record(ev)
            print(f"Recorded {ev.strategy_key} {ev.symbol} {ev.timeframe}: {ev.trades} trades, PF {ev.profit_factor}")
        if not evs:
            print("No trades found in that file.")
    if a.list or not a.import_freqtrade:
        seen = set()
        for r in store.records:
            k = (r.strategy_key, r.symbol, r.timeframe)
            if k in seen:
                continue
            seen.add(k)
            g = evaluate_gate(store.best_for(*k))
            print(f"{g['status']:22s} {r.strategy_key:22s} {r.symbol:12s} {r.timeframe:5s} trades={r.trades} PF={r.profit_factor}")
        if not store.records:
            print("No evidence recorded yet.")
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
