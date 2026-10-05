"""
core/realism.py  (2026-10-03 calibration) -- Python mirror of src/utils/realism.js.

Costs, exchange minimum order, market-data quality gate, strategy promotion bar and the
flash-loan observation lock, all driven by config/realism.json (same file the Node side reads).
Pure functions; no network calls.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

ROOT = Path(__file__).resolve().parents[1]
CFG_PATH = ROOT / "config" / "realism.json"

_DEFAULT = {
    "costs": {"fee_pct_per_side": 0.06, "slippage_pct_per_side": 0.02},
    "min_order": {"exchange": "bitget", "cache_file": "data/exchange_limits.json", "max_age_hours": 24, "safety_buffer_pct": 5},
    "data_quality": {"min_candles": 50, "max_candle_age_multiple": 2.5, "rsi_pegged_low": 1, "rsi_pegged_high": 99,
                     "atr_min_pct_of_price": 0.0001, "min_distinct_closes_last20": 3,
                     "max_ticker_vs_candle_deviation_pct": 5, "allow_synthetic_candles": False},
    "promotion": {"min_oos_trades": 60, "min_profit_factor": 1.3, "min_oos_profit_factor": 1.3, "max_drawdown_pct": 20,
                  "live_gate_win_rate": 0.68, "live_gate_min_trades": 250, "require_fees_included": True},
    "arbitrage": {"mode": "observe", "fork_test_marker": "flashloan-sim/results/fork_test_passed.json"},
}


def _load() -> Dict[str, Any]:
    try:
        return json.loads(CFG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return _DEFAULT


CFG = _load()


def _num(name: str, default: float) -> float:
    try:
        v = os.getenv(name)
        return float(v) if v not in (None, "") else float(default)
    except (TypeError, ValueError):
        return float(default)


# ---------------------------------------------------------------- costs
def fee_pct_per_side() -> float:
    return _num("REALISM_FEE_PCT", CFG["costs"]["fee_pct_per_side"])


def slippage_pct_per_side() -> float:
    return _num("REALISM_SLIPPAGE_PCT", CFG["costs"]["slippage_pct_per_side"])


def cost_fraction_per_side() -> float:
    """0.0008 for the default 0.06% fee + 0.02% slippage."""
    return (fee_pct_per_side() + slippage_pct_per_side()) / 100.0


def round_trip_cost_pct() -> float:
    return 2.0 * (fee_pct_per_side() + slippage_pct_per_side())


# ---------------------------------------------------------------- exchange minimum order
def _normalise_pair(pair: str) -> str:
    p = str(pair or "").upper()
    if "/" in p:
        return p
    if p.endswith("USDT"):
        return p[:-4] + "/USDT"
    return p + "/USDT"


def min_order_usd(pair: str, price: Optional[float] = None) -> Dict[str, Any]:
    path = ROOT / CFG["min_order"]["cache_file"]
    try:
        lim = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"min_usd": None, "source": "no-exchange-limits-cache"}
    m = (lim.get("markets") or {}).get(_normalise_pair(pair))
    if not m:
        return {"min_usd": None, "source": f"pair-not-listed-on-{lim.get('exchange')}"}
    px = float(price) if price and float(price) > 0 else float(m.get("lastPrice") or 0)
    by_amount = (m.get("minAmount") or 0) * px if px else 0.0
    raw = max(m.get("minCostUsd") or 0.0, by_amount)
    buffered = raw * (1 + CFG["min_order"].get("safety_buffer_pct", 0) / 100.0)
    return {"min_usd": round(buffered, 4), "source": f"{lim.get('exchange')}-market-info"}


# ---------------------------------------------------------------- data-quality gate
def data_quality_check(candles: Sequence[Sequence[float]], timeframe_s: int = 3600, now_s: Optional[float] = None,
                       rsi14: Optional[float] = None, atr14: Optional[float] = None,
                       ticker_last: Optional[float] = None, candles_source: str = "exchange") -> Dict[str, Any]:
    """candles: [[ts_ms, o, h, l, c, v], ...] oldest -> newest. Fail-closed; returns {ok, reasons, metrics}."""
    q = CFG["data_quality"]
    reasons: List[str] = []
    metrics: Dict[str, Any] = {"candles": len(candles)}
    if candles_source in ("synthetic", "none"):
        reasons.append(f"candles are {'missing' if candles_source == 'none' else 'synthetic'}")
    if len(candles) < q["min_candles"]:
        reasons.append(f"only {len(candles)} candles (need {q['min_candles']})")
    if candles:
        now = (now_s if now_s is not None else time.time())
        age_s = now - float(candles[-1][0]) / 1000.0
        metrics["last_candle_age_min"] = round(age_s / 60, 1)
        if age_s > q["max_candle_age_multiple"] * timeframe_s:
            reasons.append(f"stale candles (last one opened {metrics['last_candle_age_min']} min ago)")
        closes = [float(c[4]) for c in candles]
        if len({round(x, 10) for x in closes[-20:]}) < q["min_distinct_closes_last20"]:
            reasons.append("flat price series")
        if all(not (float(c[5]) > 0) for c in candles[-10:]):
            reasons.append("zero volume on the last 10 candles")
        if any(not (x > 0) for x in closes):
            reasons.append("non-positive close price in series")
    if rsi14 is not None and (rsi14 <= q["rsi_pegged_low"] or rsi14 >= q["rsi_pegged_high"]):
        reasons.append(f"RSI pegged at {rsi14}")
    price = float(candles[-1][4]) if candles else 0.0
    if atr14 is not None and (not atr14 > 0 or (price > 0 and atr14 / price < q["atr_min_pct_of_price"])):
        reasons.append(f"ATR is zero/degenerate ({atr14})")
    if ticker_last and candles:
        dev = abs(float(ticker_last) - price) / price * 100 if price else 0
        metrics["ticker_vs_candle_dev_pct"] = round(dev, 2)
        if dev > q["max_ticker_vs_candle_deviation_pct"]:
            reasons.append(f"ticker and candles disagree by {dev:.1f}%")
    return {"ok": not reasons, "reasons": reasons, "metrics": metrics}


# ---------------------------------------------------------------- promotion bar
def promotion_bar() -> Dict[str, Any]:
    p = CFG["promotion"]
    return {
        "min_oos_trades": int(_num("REALISM_MIN_OOS_TRADES", p["min_oos_trades"])),
        "min_profit_factor": _num("REALISM_MIN_PF", p["min_profit_factor"]),
        "min_oos_profit_factor": _num("REALISM_MIN_OOS_PF", p["min_oos_profit_factor"]),
        "max_drawdown_pct": _num("REALISM_MAX_DD_PCT", p["max_drawdown_pct"]),
        "live_gate_win_rate": _num("LIVE_GATE_WIN_RATE", p["live_gate_win_rate"]),
        "live_gate_min_trades": int(_num("LIVE_GATE_MIN_TRADES", p["live_gate_min_trades"])),
        "require_fees_included": bool(p.get("require_fees_included", True)),
    }


def pnl_stats(pnls: Sequence[float], start_equity: float = 1000.0) -> Dict[str, float]:
    gw = gl = 0.0
    eq = peak = start_equity
    max_dd = 0.0
    for p in pnls:
        if p > 0:
            gw += p
        elif p < 0:
            gl += -p
        eq += p
        peak = max(peak, eq)
        if peak > 0:
            max_dd = max(max_dd, (peak - eq) / peak * 100)
    pf = (99.0 if gw > 0 else 0.0) if gl == 0 else gw / gl
    return {"profit_factor": round(pf, 3), "max_drawdown_pct": round(max_dd, 2),
            "gross_win": round(gw, 2), "gross_loss": round(gl, 2)}


def promotion_check(oos_trades: Optional[int], profit_factor: Optional[float], max_drawdown_pct: Optional[float],
                    fees_included: Optional[bool], oos_profit_factor: Optional[float] = None) -> Dict[str, Any]:
    b = promotion_bar()
    r: List[str] = []
    if not (oos_trades is not None and oos_trades >= b["min_oos_trades"]):
        r.append(f"out-of-sample trades {oos_trades} < {b['min_oos_trades']}")
    if not (profit_factor is not None and profit_factor > b["min_profit_factor"]):
        r.append(f"profit factor {profit_factor} not above {b['min_profit_factor']}")
    if oos_profit_factor is not None and not oos_profit_factor > b["min_oos_profit_factor"]:
        r.append(f"OOS profit factor {oos_profit_factor} not above {b['min_oos_profit_factor']}")
    if not (max_drawdown_pct is not None and max_drawdown_pct < b["max_drawdown_pct"]):
        r.append(f"drawdown {max_drawdown_pct}% not under {b['max_drawdown_pct']}%")
    if b["require_fees_included"] and fees_included is not True:
        r.append("fees/slippage not confirmed as included")
    return {"passed": not r, "reasons": r}


# ---------------------------------------------------------------- flash-loan observation lock
def arbitrage_mode() -> str:
    return str(os.getenv("ARB_MODE") or CFG["arbitrage"].get("mode", "observe")).lower()


def fork_test_passed() -> bool:
    try:
        m = json.loads((ROOT / CFG["arbitrage"]["fork_test_marker"]).read_text(encoding="utf-8"))
        return bool(m.get("passed") is True)
    except Exception:
        return False


def live_arb_allowed() -> bool:
    return arbitrage_mode() == "live" and fork_test_passed()
