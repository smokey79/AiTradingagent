"""
scripts/debate_runner.py

Continuous background runner for the Multi-LLM Debate Engine.
Periodically fetches latest market context, orchestrates Bull/Bear/Neutral
debate rounds, and publishes final trade decisions to the Node.js bridge.

Alan J | barcay0611@gmail.com | github: smokey79
"""

from __future__ import annotations

import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

# Ensure project root is on PYTHONPATH
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from agents.debate_agent import DebateOrchestrator, DebateMessage
from agents.learning_agent import LearningAgent
from bridge.python_to_node import BridgePublisher, publish_decision
from core.data_schema import Candle, DataSource
from core.llm_router import LLMRouter, LLMClient

# Logging
os.makedirs(ROOT / "logs", exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [debate-runner] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(ROOT / "logs" / "python-debate.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger("debate_runner")

DEBATE_INTERVAL_S = int(os.getenv("DEBATE_INTERVAL_S", "120"))
DEBATE_SYMBOL = os.getenv("DEBATE_SYMBOL", "BTCUSDT")
PAPER_TRADE_MODE = os.getenv("PAPER_TRADE_MODE", "true").lower() == "true"


def get_latest_market_candle(symbol: str = "BTCUSDT") -> Candle:
    """Fetch real-world price via CCXT (Bitget) or CoinGecko, fallback to placeholder."""
    now_dt = datetime.now(timezone.utc)

    # FIX 2026-09-13: was inline ccxt.binance here with ad-hoc symbol slicing.
    # Now uses the shared data.market_data.get_latest_candle() (CCXT primary,
    # CoinGecko fallback, proper pair normalisation) so every caller — this
    # runner, price_aggregator, a future backtester — hits the same logic and
    # the same exchange choice. Exchange is configurable via MARKET_DATA_EXCHANGE
    # (default "bitget" — the project's chosen venue).
    try:
        from data.market_data import get_latest_candle as _fetch_live_candle
        candle = _fetch_live_candle(
            symbol,
            exchange_id=os.getenv("MARKET_DATA_EXCHANGE", "bitget"),
            timeframe="1h",
        )
        if candle is not None:
            return candle
    except Exception as e:
        logger.debug("Live candle fetch failed for %s: %s", symbol, e)

    # Last resort — placeholder candle (logged as warning)
    logger.warning("Using placeholder candle for %s — all data sources failed.", symbol)
    return Candle(
        timestamp=now_dt,
        symbol=symbol,
        open=65000.0,
        high=65500.0,
        low=64800.0,
        close=65200.0,
        volume=50.0,
        source=DataSource.BACKTEST,
    )


def build_market_features(candle: Candle) -> Dict[str, float]:
    """Derive key technical features for debate context."""
    change_pct = ((candle.close - candle.open) / candle.open) * 100
    # Compute approximate RSI from candle body direction
    body_ratio = (candle.close - candle.open) / candle.open if candle.open > 0 else 0
    rsi_approx = 50.0 + (body_ratio * 500.0)  # Scale body to RSI-like range
    rsi_approx = max(10.0, min(90.0, rsi_approx))  # Clamp to realistic RSI

    # EMA proxies — use close-based approximations
    ema_50 = round(candle.close * (1.0 - abs(body_ratio) * 0.5), 2)
    ema_200 = round(candle.close * (1.0 - abs(body_ratio) * 1.5), 2)

    # Volatility from candle range
    price_range = candle.high - candle.low
    volatility = (price_range / candle.close * 100) if candle.close > 0 else 0

    return {
        "price": candle.close,
        "change_pct": round(change_pct, 3),
        "rsi_14": round(rsi_approx, 1),
        "ema_50": ema_50,
        "ema_200": ema_200,
        "volatility": round(volatility, 2),
        "body_ratio": round(body_ratio, 4),
        "upper_wick": round(candle.upper_wick, 2),
        "lower_wick": round(candle.lower_wick, 2),
        "is_bullish": 1.0 if candle.is_bullish else 0.0,
    }


def main():
    logger.info("Starting Multi-LLM Debate Runner (Interval=%ss, Symbol=%s, Paper=%s)",
                DEBATE_INTERVAL_S, DEBATE_SYMBOL, PAPER_TRADE_MODE)
    
    # Initialize Learning Agent
    learning_agent = LearningAgent()
    bridge = BridgePublisher()

    # Configure router
    # FIX 2026-09-13: this used to only check for an Anthropic/Grok key
    # before even trying to build a router, so a .env with only
    # GEMINI_API_KEY / OPENROUTER_API_KEY (your actual free-model-first
    # setup) would skip straight to the heuristic mock decision instead of
    # running the real multi-LLM debate. Just try building the router —
    # LLMRouter.from_config() already wires whichever of Gemini / Anthropic
    # / Grok / OpenRouter have keys set, and raises a clear error only if
    # none of them do.
    router = None
    has_live_keys = True
    try:
        router = LLMRouter.from_config()
    except Exception as err:
        logger.warning("Could not build LLMRouter from config (%s); falling back to mock.", err)
        has_live_keys = False

    if not has_live_keys:
        logger.info("Running debate engine in heuristic/offline paper debate mode.")

    while True:
        try:
            candle = get_latest_market_candle(DEBATE_SYMBOL)
            features = build_market_features(candle)
            learned_context = learning_agent.get_prompt_context()

            logger.info("Running debate for %s @ $%s...", candle.symbol, candle.close)
            
            if has_live_keys:
                orchestrator = DebateOrchestrator.from_router(router)
                decision, transcript = orchestrator.run(candle, features, learned_context)
            else:
                # Mock debate with rule-based fallback decision
                decision = {
                    "action": "LONG" if features["change_pct"] > 0 else "FLAT",
                    "size": 0.25 if features["change_pct"] > 0 else 0.0,
                    "reason": f"Paper baseline momentum check ({features['change_pct']}% 1h change)",
                    "source": "debate_paper",
                    "confidence": 0.72,
                }
                transcript = [
                    DebateMessage("bull", f"Momentum positive at {features['change_pct']}%, above 50-EMA."),
                    DebateMessage("bear", "Resistance near overhead levels, keep tight risk."),
                    DebateMessage("neutral", "Market balanced, small position warranted."),
                    DebateMessage("facilitator", f"Decision: {decision['action']}"),
                ]

            logger.info("Debate decision: %s (size=%.2f) — %s",
                        decision["action"], decision.get("size", 0.0), decision.get("reason", ""))

            # Record outcome in learning agent for weight adaptation
            try:
                from agents.learning_agent import TradeRecord
                trade_record = TradeRecord(
                    trade_id=f"debate_{int(time.time())}",
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    symbol=candle.symbol,
                    action=decision["action"],
                    size=float(decision.get("size", 0.0)),
                    entry_price=candle.close,
                    exit_price=candle.close,  # Will be updated on position close
                    pnl_usd=0.0,
                    pnl_pct=0.0,
                    hold_bars=0,
                    pattern_name=None,
                    signal_source="debate",
                    llm_provider="router",
                    features=str(features),
                    decision_reason=str(decision.get("reason", "")),
                    was_correct=decision["action"] != "FLAT",
                )
                learning_agent.after_trade(trade_record)
            except Exception as learn_err:
                logger.debug("Learning agent recording failed: %s", learn_err)

            # Publish to Node.js bridge & files
            bridge.on_decision(
                symbol=candle.symbol,
                action=decision["action"],
                size=float(decision.get("size", 0.0)),
                reason=str(decision.get("reason", "")),
                source="debate",
                confidence=float(decision.get("confidence", 0.75)),
            )

        except Exception as exc:
            logger.error("Error during debate cycle: %s", exc, exc_info=True)

        time.sleep(DEBATE_INTERVAL_S)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Debate runner stopped by user.")
