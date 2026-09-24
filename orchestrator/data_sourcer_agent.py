"""
orchestrator/data_sourcer_agent.py
===================================
Agent Data Sourcer: measures data-feed quality and the bot's real rolling win rate.

2026-09-24 rewrite: only real, measured numbers.
Before this date the agent reported invented figures: a cold-start seed of 18 wins /
5 losses (78.2%) when no trades existed, fixed "accuracy" (e.g. 91.5%), fixed
"contribution to PnL" (e.g. +32.4%), fixed latencies, and quality scores of 80-94
for feeds even when no data had arrived. Those numbers fed the consensus vote, the
Monte Carlo risk model and the 68% gate.

What is measured now
--------------------
- Rolling win rate: from real closed trades only. Sources, first non-empty wins:
    1. data/trade_ledger.json (JSON lines; PENDING, simulated, FLASHLOAN and
       excludeFromLearning records are ignored, same rule as src/risk/tradeLedger.js)
    2. data/trading.db  table `trades` (status closed/FILLED/completed)
    3. src/strategy/strategy_memory.json  tradeHistory
  With no trades the win rate is None, not a guess.
- 68% gate: met only with at least GATE_MIN_SAMPLE (250) real trades AND win rate >= 68%.
  Below 250 trades the gate is "not yet applicable" (paper sampling), reported as such.
- Feed quality score (0-100) per feed, from the data actually passed in:
    available?  (0 if no data)  x  completeness (share of expected fields present)
    x  freshness (full marks under 15 min old, falling to 0 at 24 h, if a timestamp exists)
- Per-feed accuracy and PnL contribution: None ("not measured"). Trades are not tagged
  with the feeds that produced them, so these cannot be computed honestly. If a trade
  record carries a `data_sources` / `feeds` list, they are computed from it.
- Latency: only if the feed payload reports `latency_ms`.
- Composite score: weighted mean over ALL configured feeds, missing feeds count as 0,
  so it reflects real coverage.

Environment overrides:
    RISK_MIN_WIN_RATE_GATE   default 0.68
    GATE_MIN_SAMPLE          default 250 (or RISK_GATE_MIN_TRADES)
    RISK_PRIOR_WIN_RATE      default 0.50  (used ONLY by the Monte Carlo model while
                                            there are fewer than GATE_MIN_SAMPLE trades;
                                            labelled as a prior, never shown as measured)
"""

import os
import sys
import json
import sqlite3
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
if hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = PROJECT_ROOT / "data" / "trading.db"
LEDGER_PATH = PROJECT_ROOT / "data" / "trade_ledger.json"
MEMORY_PATH = PROJECT_ROOT / "src" / "strategy" / "strategy_memory.json"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [DataSourcer] %(message)s")
log = logging.getLogger("DataSourcerAgent")

TARGET_WIN_RATE_GATE = float(os.getenv("RISK_MIN_WIN_RATE_GATE", "0.68"))  # 68% (Alan, 2026-09-15/24)
GATE_MIN_SAMPLE = int(os.getenv("GATE_MIN_SAMPLE", os.getenv("RISK_GATE_MIN_TRADES", "250")))
RISK_PRIOR_WIN_RATE = float(os.getenv("RISK_PRIOR_WIN_RATE", "0.50"))

# Configured importance of each feed (a setting, not a performance claim).
FEED_WEIGHTS = {
    "ccxt_orderbook": 0.25,
    "arbitrage_flashloans": 0.10,
    "luxalgo_learning": 0.10,
    "sosovalue_etf": 0.15,
    "coinmarketcap": 0.10,
    "sopr_mvrv_onchain": 0.10,
    "relative_strength": 0.10,
    "volatility_regime": 0.10,
}

FEED_NAMES = {
    "ccxt_orderbook": "CCXT Order Book & Liquidity Feed",
    "arbitrage_flashloans": "Cross-DEX Arbitrage & Flash Loans",
    "luxalgo_learning": "LuxAlgo SMC & YouTube Alpha",
    "sosovalue_etf": "SoSoValue Institutional ETF Flows",
    "coinmarketcap": "CoinMarketCap Quotes & Global Dominance",
    "sopr_mvrv_onchain": "SOPR / MVRV Cycle Valuation",
    "relative_strength": "Cross-Asset Relative Strength & Rotation",
    "volatility_regime": "ATR Volatility & Breakout Squeeze",
}

# Fields each feed is expected to provide (dotted paths). Used for completeness.
EXPECTED_FIELDS = {
    "ccxt_orderbook": ["tickers", "order_book.bids", "order_book.asks"],
    "sosovalue_etf": ["btc_etf.total_net_flow_usd_m", "eth_etf.total_net_flow_usd_m"],
    "coinmarketcap": ["quotes"],
    "sopr_mvrv_onchain": ["mvrv_proxy", "cycle_phase"],
    "relative_strength": ["relative_strength_score"],
    "volatility_regime": ["regime"],
    "arbitrage_flashloans": ["opportunities"],
}

TIMESTAMP_KEYS = ("fetched_at", "timestamp", "updated_at", "as_of", "time")


def _get_path(d: Any, dotted: str) -> Any:
    cur = d
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _present(v: Any) -> bool:
    if v is None:
        return False
    if isinstance(v, (list, dict, str)) and len(v) == 0:
        return False
    return True


def _age_seconds(payload: Dict[str, Any]) -> Optional[float]:
    for k in TIMESTAMP_KEYS:
        v = payload.get(k) if isinstance(payload, dict) else None
        if v is None:
            continue
        try:
            if isinstance(v, (int, float)):
                ts = datetime.fromtimestamp(v / 1000 if v > 1e12 else v, tz=timezone.utc)
            else:
                ts = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
            return max(0.0, (datetime.now(timezone.utc) - ts).total_seconds())
        except Exception:
            continue
    return None


def _freshness_factor(age_s: Optional[float]) -> float:
    """1.0 under 15 minutes, linear down to 0 at 24 hours. Unknown age = 0.8 (no bonus, small penalty)."""
    if age_s is None:
        return 0.8
    if age_s <= 900:
        return 1.0
    if age_s >= 86400:
        return 0.0
    return round(1.0 - (age_s - 900) / (86400 - 900), 3)


def _is_fallback(payload: Dict[str, Any]) -> bool:
    """
    True if the feed says it is serving placeholder data. Checks the top level, and nested
    sections (e.g. btc_etf / eth_etf): if every nested section that carries a flag says fallback,
    the whole payload is treated as fallback.
    """
    flags = ("is_fallback", "fallback", "synthetic", "is_synthetic", "mock")
    if any(payload.get(f) is True for f in flags):
        return True
    flagged = [v for v in payload.values() if isinstance(v, dict) and any(f in v for f in flags)]
    return bool(flagged) and all(any(v.get(f) is True for f in flags) for v in flagged)


def score_feed(key: str, payload: Any) -> Dict[str, Any]:
    """Measured quality of one feed from its actual payload."""
    name = FEED_NAMES.get(key, key)
    weight = FEED_WEIGHTS.get(key, 0.0)
    if not _present(payload) or not isinstance(payload, dict):
        return {"name": name, "score": 0.0, "available": False, "completeness_pct": 0.0,
                "age_seconds": None, "accuracy_pct": None, "profit_weight": weight,
                "latency_ms": None, "status": "NO_DATA", "contribution_to_pnl": None}
    if _is_fallback(payload):
        return {"name": name, "score": 0.0, "available": False, "completeness_pct": 0.0,
                "age_seconds": None, "accuracy_pct": None, "profit_weight": weight, "latency_ms": None,
                "status": "FALLBACK_DATA (placeholder values, not real)", "contribution_to_pnl": None}
    expected = EXPECTED_FIELDS.get(key, [])
    got = sum(1 for f in expected if _present(_get_path(payload, f)))
    completeness = (got / len(expected)) if expected else 1.0
    age = _age_seconds(payload)
    fresh = _freshness_factor(age)
    score = round(100.0 * completeness * fresh, 1)
    status = "OK" if score >= 75 else ("DEGRADED" if score > 0 else "STALE_OR_EMPTY")
    latency = payload.get("latency_ms") if isinstance(payload.get("latency_ms"), (int, float)) else None
    return {"name": name, "score": score, "available": True, "completeness_pct": round(completeness * 100, 1),
            "age_seconds": round(age, 1) if age is not None else None, "accuracy_pct": None,
            "profit_weight": weight, "latency_ms": latency, "status": status, "contribution_to_pnl": None}


def _outcome(pnl: float) -> str:
    return "WIN" if pnl > 0 else ("LOSS" if pnl < 0 else "BREAKEVEN")


class DataSourcerAgent:
    """
    Measures feed quality from the data actually received and the rolling win rate from
    real closed trades. Reports None / "not measured" instead of estimates.
    """

    def __init__(self):
        self.default_weights = dict(FEED_WEIGHTS)

    # ── Trade history (real records only) ────────────────────────────────────

    def _ledger_trades(self, limit: int) -> List[Dict[str, Any]]:
        if not LEDGER_PATH.exists():
            return []
        rows: List[Dict[str, Any]] = []
        try:
            text = LEDGER_PATH.read_text(encoding="utf-8").strip()
            if text.startswith("["):
                rows = json.loads(text)
            else:
                rows = [json.loads(line) for line in text.splitlines() if line.strip()]
        except Exception as e:
            log.warning(f"Could not read trade ledger: {e}")
            return []
        real = [r for r in rows if isinstance(r, dict)
                and r.get("outcome") in ("WIN", "LOSS", "BREAKEVEN")
                and r.get("simulated") is not True
                and r.get("excludeFromLearning") is not True
                and r.get("side") != "FLASHLOAN"]
        out = []
        for r in real[-limit:]:
            pnl = r.get("pnlUsd")
            out.append({"outcome": r["outcome"], "pnl_usdt": float(pnl) if pnl is not None else None,
                        "source": "trade_ledger",
                        "data_sources": r.get("data_sources") or r.get("feeds")})
        return out

    def _db_trades(self, limit: int) -> List[Dict[str, Any]]:
        if not DB_PATH.exists():
            return []
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM trades WHERE status IN ('closed','FILLED','completed') AND pnl_usdt IS NOT NULL "
                "ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
            conn.close()
            return [{"outcome": _outcome(float(r["pnl_usdt"])), "pnl_usdt": float(r["pnl_usdt"]),
                     "source": "trading.db", "data_sources": None} for r in rows]
        except Exception as e:
            log.warning(f"Error reading trades from DB: {e}")
            return []

    def _memory_trades(self, limit: int) -> List[Dict[str, Any]]:
        if not MEMORY_PATH.exists():
            return []
        try:
            m = json.loads(MEMORY_PATH.read_text(encoding="utf-8"))
            hist = [t for t in m.get("tradeHistory", []) if isinstance(t, dict)]
            out = []
            for t in hist[-limit:]:
                pnl = t.get("pnl_usdt", t.get("pnlUsd", t.get("pnl")))
                if pnl is None:
                    continue
                out.append({"outcome": _outcome(float(pnl)), "pnl_usdt": float(pnl), "source": "strategy_memory",
                            "data_sources": t.get("data_sources") or t.get("feeds")})
            return out
        except Exception:
            return []

    def _get_trade_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        for getter in (self._ledger_trades, self._db_trades, self._memory_trades):
            rows = getter(limit)
            if rows:
                return rows
        return []

    # ── Evaluation ───────────────────────────────────────────────────────────

    def evaluate_feeds(
        self,
        market_data: Optional[Dict[str, Any]] = None,
        macro_data: Optional[Dict[str, Any]] = None,
        onchain_data: Optional[Dict[str, Any]] = None,
        rs_data: Optional[Dict[str, Any]] = None,
        vol_data: Optional[Dict[str, Any]] = None,
        sentiment_data: Optional[Dict[str, Any]] = None,
        coinmarketcap_data: Optional[Dict[str, Any]] = None,
        arbitrage_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Returns measured feed quality, the real rolling win rate and the 68% gate status."""
        trades = self._get_trade_history(max(GATE_MIN_SAMPLE, 50))
        wins = sum(1 for t in trades if t["outcome"] == "WIN")
        losses = sum(1 for t in trades if t["outcome"] == "LOSS")
        total = wins + losses          # breakevens excluded from the win-rate denominator
        win_rate: Optional[float] = (wins / total) if total > 0 else None
        total_pnl = sum(t["pnl_usdt"] for t in trades if t["pnl_usdt"] is not None)

        gate_applicable = total >= GATE_MIN_SAMPLE
        gate_met = bool(gate_applicable and win_rate is not None and win_rate >= TARGET_WIN_RATE_GATE)
        if not gate_applicable:
            gate_status = f"COLLECTING_SAMPLE ({total}/{GATE_MIN_SAMPLE} real trades)"
        else:
            gate_status = "MET" if gate_met else "FAILED"

        # Feed quality from what actually arrived
        feed_scores: Dict[str, Dict[str, Any]] = {
            "ccxt_orderbook": score_feed("ccxt_orderbook", market_data),
            "sosovalue_etf": score_feed("sosovalue_etf", macro_data),
            "coinmarketcap": score_feed("coinmarketcap", coinmarketcap_data),
            "sopr_mvrv_onchain": score_feed("sopr_mvrv_onchain", onchain_data),
            "relative_strength": score_feed("relative_strength", rs_data),
            "volatility_regime": score_feed("volatility_regime", vol_data),
            "arbitrage_flashloans": score_feed("arbitrage_flashloans", arbitrage_data),
        }

        # LuxAlgo / YouTube: quality = share of channels with a real transcript
        lux = {"name": FEED_NAMES["luxalgo_learning"], "score": 0.0, "available": False, "completeness_pct": 0.0,
               "age_seconds": None, "accuracy_pct": None, "profit_weight": FEED_WEIGHTS["luxalgo_learning"],
               "latency_ms": None, "status": "NO_DATA", "contribution_to_pnl": None}
        try:
            from orchestrator.luxalgo_strategy_learner import LuxAlgoStrategyLearnerAgent
            yt = LuxAlgoStrategyLearnerAgent().source_all_subscription_alpha()
            n_real = int(yt.get("channels_with_real_data", 0) or 0)
            n_all = int(yt.get("total_channels_monitored", 0) or 0)
            if n_real > 0 and n_all > 0:
                cov = n_real / n_all
                lux.update({"score": round(cov * 100, 1), "available": True, "completeness_pct": round(cov * 100, 1),
                            "status": f"{n_real}/{n_all} channels with real transcripts ({yt.get('composite_market_sentiment')})"})
            else:
                lux["status"] = "NO_REAL_TRANSCRIPTS"
        except Exception as e:
            lux["status"] = f"ERROR: {e.__class__.__name__}"
        feed_scores["luxalgo_learning"] = lux

        # Per-feed accuracy / PnL only when trades are tagged with their feeds
        tagged = [t for t in trades if isinstance(t.get("data_sources"), list)]
        for key, f in feed_scores.items():
            used = [t for t in tagged if key in t["data_sources"]]
            if len(used) >= 5:
                w = sum(1 for t in used if t["outcome"] == "WIN")
                f["accuracy_pct"] = round(w / len(used) * 100, 1)
                pnl_known = [t["pnl_usdt"] for t in used if t["pnl_usdt"] is not None]
                if pnl_known:
                    f["contribution_to_pnl"] = f"{sum(pnl_known):+.2f} USDT over {len(pnl_known)} trades"

        total_weight = sum(FEED_WEIGHTS.values())
        composite_score = sum(f["score"] * f["profit_weight"] for f in feed_scores.values()) / max(total_weight, 1e-6)
        feeds_live = sum(1 for f in feed_scores.values() if f["available"])

        # Verdict: data quality first, then the gate (a failed gate always holds).
        if gate_applicable and not gate_met:
            verdict = "HOLD"
        elif composite_score >= 75.0 and gate_met:
            verdict = "PROCEED"
        elif composite_score >= 60.0:
            verdict = "PROCEED_DEFENSIVE"   # includes paper sampling before 250 trades
        else:
            verdict = "HOLD"

        risk_model_win_rate = win_rate if (gate_applicable and win_rate is not None) else RISK_PRIOR_WIN_RATE

        summary = {
            "sourcer_verdict": verdict,
            "composite_score": round(composite_score, 1),
            "feeds_live": feeds_live,
            "feeds_configured": len(feed_scores),
            "rolling_win_rate": round(win_rate, 3) if win_rate is not None else None,
            "rolling_win_rate_pct": f"{win_rate * 100:.1f}%" if win_rate is not None else "no real trades yet",
            "win_rate_source": trades[0]["source"] if trades else None,
            "win_rate_for_risk_model": round(risk_model_win_rate, 3),
            "risk_model_win_rate_is_prior": not (gate_applicable and win_rate is not None),
            "target_gate": f"{TARGET_WIN_RATE_GATE * 100:.0f}%",
            "gate_min_sample": GATE_MIN_SAMPLE,
            "gate_applicable": gate_applicable,
            "gate_status": gate_status,
            "gate_68_met": gate_met,
            "gate_72_met": gate_met,   # legacy key name, now means the 68% gate
            "total_trades_analyzed": total,
            "wins": wins,
            "losses": losses,
            "total_pnl_usdt": round(total_pnl, 2),
            "feed_scores": feed_scores,
            # Small, bounded nudge from measured data quality only (0.90x-1.05x).
            "confidence_boost": round(min(1.05, max(0.90, 1.0 + (composite_score - 80) * 0.0025)), 3),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        return summary

    def build_prompt_injection(self, summary: Dict[str, Any]) -> str:
        """Constructs concise prompt section for LLM consensus injection."""
        lines = [
            "=== AGENT DATA SOURCER (measured values only) ===",
            f"  Verdict: {summary['sourcer_verdict']} | Feed quality: {summary['composite_score']}/100 "
            f"({summary.get('feeds_live', 0)}/{summary.get('feeds_configured', 0)} feeds delivering data)",
            f"  Rolling Win Rate: {summary['rolling_win_rate_pct']} over {summary['total_trades_analyzed']} real trades "
            f"(Gate {summary['target_gate']}: {summary.get('gate_status')})",
            "  Feeds:",
        ]
        for key, f in summary.get("feed_scores", {}).items():
            acc = f"{f['accuracy_pct']}%" if f.get("accuracy_pct") is not None else "not measured"
            lines.append(f"    * {f['name'][:30]:30s}: Quality {f['score']:5.1f} | {f['status']} | Accuracy {acc}")
        lines.append(f"  Confidence Multiplier: {summary.get('confidence_boost', 1.0):.2f}x")
        return "\n".join(lines)


if __name__ == "__main__":
    sourcer = DataSourcerAgent()
    evaluation = sourcer.evaluate_feeds()
    print("\n" + "=" * 65)
    print("DATA SOURCER AGENT EVALUATION:")
    print("=" * 65)
    print(sourcer.build_prompt_injection(evaluation))
