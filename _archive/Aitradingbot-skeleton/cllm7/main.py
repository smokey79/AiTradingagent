from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from api.tradingview_webhook import router as tv_router
from agents.strategy_agent import StrategyAgent
from core.config import get_settings, ActiveLLM, ActiveExchange
from core.data_schema import Candle, DataSource
from core.llm_client import LLMClient, GrokClient, AnthropicClient

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Dependency wiring  (lazy — runs at startup, not at import time)
# ---------------------------------------------------------------------------

def _build_llm(cfg) -> LLMClient:
    """Instantiate the correct LLM client based on config."""
    key = cfg.active_llm_key
    if cfg.active_llm == ActiveLLM.GROK:
        return GrokClient(api_key=key)
    if cfg.active_llm == ActiveLLM.ANTHROPIC:
        return AnthropicClient(api_key=key)
    raise ValueError(f"Unsupported LLM: {cfg.active_llm}")


# App-level singletons — populated in lifespan, never at import time
_strategy_agent: Optional[StrategyAgent] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown logic. Replaces deprecated @app.on_event."""
    global _strategy_agent
    cfg = get_settings()
    logger.info(
        "Starting up [env=%s, exchange=%s, llm=%s]",
        cfg.env.value, cfg.active_exchange.value, cfg.active_llm.value,
    )
    llm = _build_llm(cfg)
    _strategy_agent = StrategyAgent(llm=llm)
    logger.info("Strategy agent ready.")
    yield
    logger.info("Shutting down.")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title       ="Multi-Agent Crypto Backend",
    description ="LLM-driven strategy execution and backtesting.",
    version     ="0.1.0",
    lifespan    =lifespan,
)

app.include_router(tv_router, prefix="/api/v1")


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class CandleIn(BaseModel):
    """
    Wire format for a single candle.
    `timestamp` must be an ISO-8601 string with timezone offset,
    e.g. "2024-01-15T09:30:00+00:00".
    """
    timestamp : str   = Field(..., description="ISO-8601 with timezone, e.g. 2024-01-15T09:30:00Z")
    symbol    : str   = Field(..., min_length=1, max_length=20)
    open      : float = Field(..., gt=0)
    high      : float = Field(..., gt=0)
    low       : float = Field(..., gt=0)
    close     : float = Field(..., gt=0)
    volume    : float = Field(..., ge=0)
    source    : str   = Field(default="unknown")

    def to_candle(self) -> Candle:
        """Parse and validate into a domain Candle."""
        try:
            ts = datetime.fromisoformat(self.timestamp)
        except ValueError as exc:
            raise ValueError(
                f"Invalid timestamp {self.timestamp!r}: {exc}"
            ) from exc

        if ts.tzinfo is None:
            # Assume UTC if no offset provided rather than crashing
            ts = ts.replace(tzinfo=timezone.utc)

        return Candle(
            timestamp=ts,
            symbol   =self.symbol,
            open     =self.open,
            high     =self.high,
            low      =self.low,
            close    =self.close,
            volume   =self.volume,
            source   =DataSource(self.source.lower()),
        )


class BacktestRequest(BaseModel):
    candles  : List[CandleIn]          = Field(..., min_length=1)
    features : List[Dict[str, float]]  = Field(..., min_length=1)

    @model_validator(mode="after")
    def lengths_must_match(self) -> "BacktestRequest":
        if len(self.candles) != len(self.features):
            raise ValueError(
                f"candles ({len(self.candles)}) and features "
                f"({len(self.features)}) must have the same length."
            )
        return self


class TradeRecord(BaseModel):
    candle   : Dict[str, Any]
    decision : Dict[str, Any]


class BacktestResult(BaseModel):
    equity_curve : List[float]
    trades       : List[TradeRecord]
    total_candles: int
    total_trades : int


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post(
    "/api/v1/backtest",
    response_model=BacktestResult,
    status_code=status.HTTP_200_OK,
    summary="Run a backtest over a sequence of candles",
)
def run_backtest(req: BacktestRequest) -> BacktestResult:
    if _strategy_agent is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Strategy agent not initialised.",
        )

    equity : List[float]       = [1.0]
    trades : List[TradeRecord] = []

    for idx, (c_in, feats) in enumerate(zip(req.candles, req.features)):
        try:
            candle = c_in.to_candle()
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid candle at index {idx}: {exc}",
            ) from exc

        decision = _strategy_agent.decide(candle, feats)

        # TODO: feed decision into a real portfolio simulator
        # e.g.: equity.append(portfolio.apply(decision, candle))
        equity.append(equity[-1])  # placeholder — replace with real P&L

        trades.append(TradeRecord(
            candle   =c_in.model_dump(),
            decision =decision,
        ))

        logger.debug(
            "Candle %d/%d [%s] → %s",
            idx + 1, len(req.candles), candle.symbol, decision["action"],
        )

    return BacktestResult(
        equity_curve  =equity,
        trades        =trades,
        total_candles =len(req.candles),
        total_trades  =sum(1 for t in trades if t.decision["action"] != "FLAT"),
    )


@app.get("/health", include_in_schema=False)
def health() -> Dict[str, str]:
    cfg = get_settings()
    return {
        "status"  : "ok",
        "env"     : cfg.env.value,
        "exchange": cfg.active_exchange.value,
        "llm"     : cfg.active_llm.value,
    }
