"""
scripts/hermes_analyst.py

Periodic "deep analysis" pass using the local Hermes3 model via Ollama —
kept deliberately separate from the fast Bull/Bear/Neutral debate loop
(which stays on llama3.2 for speed, see scripts/debate_runner.py).

Hermes3 is slow on this CPU-only machine (~40s+ for even a one-line
completion) and RAM-heavy (~2.3GB+ resident while loaded). Running it on
every debate round's fallback chain risked missing the 120s debate
interval and starving the rest of the PM2 stack of RAM. So instead this
runs on its own long interval, calls Ollama directly (deliberately NOT
through core.llm_router — this process only ever wants Hermes3, never a
paid/rate-limited provider), and NEVER feeds into the live trade-decision
path. It's a supplementary commentary feed only, published to
data/hermes_deep_analysis.json for the dashboard (or you) to read.

Alan J | barcay0611@gmail.com
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from core.data_schema import Candle

os.makedirs(ROOT / "logs", exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [hermes-analyst] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(ROOT / "logs" / "hermes-analyst.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger("hermes_analyst")

# Deliberately separate from OLLAMA_MODEL/HERMES_MODEL (which stay llama3.2 —
# see CLAUDE.md session notes 2026-09-13) so changing those never accidentally
# slows this down further, and vice versa.
ANALYSIS_INTERVAL_S = int(os.getenv("HERMES_ANALYSIS_INTERVAL_S", "1800"))  # 30 min default
ANALYSIS_SYMBOL = os.getenv("DEBATE_SYMBOL", "BTCUSDT")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
HERMES_MODEL_NAME = os.getenv("HERMES_ANALYST_MODEL", "hermes3")
OUTPUT_PATH = ROOT / "data" / "hermes_deep_analysis.json"


def _build_features(candle: Candle) -> dict:
    change_pct = ((candle.close - candle.open) / candle.open) * 100 if candle.open else 0.0
    price_range = candle.high - candle.low
    volatility = (price_range / candle.close * 100) if candle.close > 0 else 0.0
    return {
        "price": candle.close,
        "change_pct": round(change_pct, 3),
        "volatility": round(volatility, 2),
        "is_bullish": candle.is_bullish,
    }


def _call_hermes(prompt: str, timeout_s: int = 180) -> str:
    resp = requests.post(
        f"{OLLAMA_URL}/api/generate",
        json={"model": HERMES_MODEL_NAME, "prompt": prompt, "stream": False},
        timeout=timeout_s,
    )
    resp.raise_for_status()
    return resp.json().get("response", "").strip()


def run_one_cycle() -> None:
    from data.market_data import get_latest_candle

    candle = get_latest_candle(ANALYSIS_SYMBOL, exchange_id=os.getenv("MARKET_DATA_EXCHANGE", "bitget"))
    if candle is None:
        logger.warning("No live candle available for %s — skipping this cycle.", ANALYSIS_SYMBOL)
        return

    features = _build_features(candle)
    prompt = (
        "You are a measured crypto market analyst. Paper-trading context only, no real orders. "
        f"Symbol: {candle.symbol}. Latest price: ${candle.close:,.4f}. "
        f"1h change: {features['change_pct']}%. Volatility (range/close): {features['volatility']}%. "
        f"Candle is {'bullish' if features['is_bullish'] else 'bearish'}. "
        "Give a brief (3-4 sentence) independent read: likely near-term bias, one risk to watch, "
        "and whether this supports or contradicts a naive momentum read. Do not give financial advice — "
        "this is a log entry for a paper-trading bot, not a recommendation."
    )

    logger.info("Running Hermes3 deep analysis for %s @ $%.4f...", candle.symbol, candle.close)
    started = time.monotonic()
    try:
        analysis_text = _call_hermes(prompt)
    except Exception as exc:
        logger.error("Hermes3 call failed: %s", exc)
        return
    elapsed = time.monotonic() - started
    logger.info("Hermes3 responded in %.1fs.", elapsed)

    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "symbol": candle.symbol,
        "price": candle.close,
        "features": features,
        "analysis": analysis_text,
        "model": HERMES_MODEL_NAME,
        "elapsed_s": round(elapsed, 1),
        "note": "Supplementary commentary only — not part of the live trade-decision path.",
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)
    logger.info("Wrote analysis to %s", OUTPUT_PATH)


def main() -> None:
    logger.info(
        "Starting Hermes3 deep-analysis loop (interval=%ss, symbol=%s, model=%s). "
        "Slow + RAM-heavy by design — runs on its own schedule and never blocks "
        "or feeds into the live paper-trade decision path.",
        ANALYSIS_INTERVAL_S, ANALYSIS_SYMBOL, HERMES_MODEL_NAME,
    )
    while True:
        try:
            run_one_cycle()
        except Exception as exc:
            logger.error("Error during Hermes analysis cycle: %s", exc, exc_info=True)
        time.sleep(ANALYSIS_INTERVAL_S)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Hermes analyst stopped by user.")
