from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from core.config import get_settings, Environment

logger = logging.getLogger(__name__)
router = APIRouter(tags=["webhooks"])


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class Side(str):
    """Normalised side — validated to exactly one of LONG | SHORT | FLAT."""
    VALID = frozenset({"long", "short", "flat"})


class TVSignal(BaseModel):
    symbol : str         = Field(..., min_length=1, max_length=20)
    side   : str         = Field(..., description="long | short | flat")
    size   : float       = Field(default=0.0, ge=0.0, le=1.0)
    extra  : Optional[Dict[str, Any]] = None

    @field_validator("symbol")
    @classmethod
    def normalise_symbol(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("side")
    @classmethod
    def normalise_side(cls, v: str) -> str:
        normalised = v.strip().lower()
        if normalised not in {"long", "short", "flat"}:
            raise ValueError(
                f"Invalid side {v!r}. Must be one of: long, short, flat."
            )
        return normalised


class WebhookResponse(BaseModel):
    status  : str
    symbol  : str
    side    : str
    size    : float
    queued  : bool = False


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def _verify_secret(provided: Optional[str], expected: str) -> bool:
    """Constant-time comparison to prevent timing attacks."""
    if not provided:
        return False
    return hmac.compare_digest(
        provided.encode(),
        expected.encode(),
    )


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post(
    "/tradingview/webhook",
    response_model=WebhookResponse,
    status_code=status.HTTP_200_OK,
    summary="Receive a signal from TradingView alerts",
)
async def tradingview_webhook(
    signal   : TVSignal,
    request  : Request,
    tv_secret: Optional[str] = Header(None, alias="X-TV-SECRET"),
) -> WebhookResponse:
    """
    Accepts a TradingView alert payload and enqueues it for execution.

    Authentication:
    - In production/staging: `X-TV-SECRET` header must match
      `APP_TRADINGVIEW_WEBHOOK_SECRET` in the environment.
    - In development/test: auth is skipped (logged as a warning).
    """
    cfg = get_settings()

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------
    if cfg.env in (Environment.PRODUCTION, Environment.STAGING):
        if cfg.tradingview_webhook_secret is None:
            # Misconfigured server — don't leak details to the caller
            logger.error(
                "tradingview_webhook_secret is not set in %s — rejecting all requests.",
                cfg.env.value,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Webhook authentication is not configured.",
            )
        if not _verify_secret(
            tv_secret,
            cfg.tradingview_webhook_secret.get_secret_value(),
        ):
            logger.warning(
                "Rejected webhook from %s — invalid secret.",
                request.client.host if request.client else "unknown",
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing X-TV-SECRET header.",
            )
    else:
        logger.warning(
            "Webhook auth skipped in %s environment.", cfg.env.value
        )

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------
    logger.info(
        "Webhook received: symbol=%s side=%s size=%.3f",
        signal.symbol, signal.side, signal.size,
    )

    queued = await _enqueue_signal(signal)

    return WebhookResponse(
        status ="ok",
        symbol =signal.symbol,
        side   =signal.side,
        size   =signal.size,
        queued =queued,
    )


# ---------------------------------------------------------------------------
# Stub: signal dispatch
# ---------------------------------------------------------------------------

async def _enqueue_signal(signal: TVSignal) -> bool:
    """
    Enqueue the signal for live execution or backtest replay.

    Replace the stub body with one of:
      - asyncio.Queue  (in-process, single worker)
      - Redis / RQ     (multi-process)
      - Kafka / Pulsar (distributed)

    Returns True if the signal was successfully enqueued.
    """
    # TODO: implement real queue dispatch
    # e.g.:
    #   await redis.xadd("signals", signal.model_dump())
    #   return True
    logger.debug("_enqueue_signal stub called for %s — not yet implemented.", signal.symbol)
    return False
