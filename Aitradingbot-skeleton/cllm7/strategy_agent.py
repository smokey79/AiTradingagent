from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, Optional, TypedDict

from core.llm_client import LLMClient
from core.data_schema import Candle

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Return type
# ---------------------------------------------------------------------------

class Decision(TypedDict):
    action : str          # "LONG" | "SHORT" | "FLAT"
    size   : float        # fraction of max position, [0.0, 1.0]
    reason : str
    source : str          # "llm" | "baseline" | "fallback"


VALID_ACTIONS = frozenset({"LONG", "SHORT", "FLAT"})


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class StrategyAgent:
    """
    Combines a deterministic baseline rule with an LLM overlay.

    Decision priority:
      1. LLM response (if reachable and parseable)
      2. Baseline rule (if LLM fails)
    The `source` field in the returned Decision records which path was taken.
    """

    def __init__(
        self,
        llm: LLMClient,
        fallback_size: float = 0.2,
        size_clamp: tuple[float, float] = (0.0, 1.0),
    ) -> None:
        if not (0.0 <= fallback_size <= 1.0):
            raise ValueError(f"fallback_size must be in [0, 1], got {fallback_size}.")
        self.llm           = llm
        self.fallback_size = fallback_size
        self.size_clamp    = size_clamp

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def decide(self, candle: Candle, features: Dict[str, float]) -> Decision:
        """
        Returns a Decision for the given candle + feature snapshot.
        Never raises — falls back to the deterministic baseline on any error.
        """
        baseline = self._baseline_decision(features)

        try:
            prompt   = self._build_prompt(candle, features, baseline["action"])
            raw      = self.llm.generate_text(prompt)
            decision = self._parse_response(raw)
            decision["source"] = "llm"
            logger.debug("LLM decision for %s: %s", candle.symbol, decision)
            return decision

        except LLMParseError as exc:
            logger.warning("LLM response unparseable for %s: %s", candle.symbol, exc)
        except Exception as exc:  # noqa: BLE001  (network / auth / rate-limit)
            logger.warning("LLM call failed for %s: %s", candle.symbol, exc)

        return baseline

    # ------------------------------------------------------------------
    # Baseline rule
    # ------------------------------------------------------------------

    def _baseline_decision(self, features: Dict[str, float]) -> Decision:
        trend = features.get("trend_score", 0.0)
        if trend > 0.7:
            action = "LONG"
        elif trend < -0.7:
            action = "SHORT"
        else:
            action = "FLAT"

        return Decision(
            action=action,
            size=self.fallback_size if action != "FLAT" else 0.0,
            reason=f"Baseline rule: trend_score={trend:.3f}.",
            source="baseline",
        )

    # ------------------------------------------------------------------
    # Prompt construction
    # ------------------------------------------------------------------

    @staticmethod
    def _format_features(features: Dict[str, float]) -> str:
        """Render features as a compact, human-readable list."""
        return "\n".join(f"  {k}: {v:.4f}" for k, v in sorted(features.items()))

    def _build_prompt(
        self,
        candle: Candle,
        features: Dict[str, float],
        baseline_action: str,
    ) -> str:
        return (
            "You are a systematic trading strategy assistant.\n"
            "Respond with ONLY a JSON object — no markdown, no extra text.\n\n"
            f"Symbol     : {candle.symbol}\n"
            f"Timestamp  : {candle.timestamp.isoformat()}\n"
            f"Last close : {candle.close}\n"
            f"OHLC       : O={candle.open} H={candle.high} L={candle.low} C={candle.close}\n"
            f"Volume     : {candle.volume}\n\n"
            "Features:\n"
            f"{self._format_features(features)}\n\n"
            f"Baseline action (deterministic rule): {baseline_action}\n\n"
            "Task:\n"
            "1. Decide the action: LONG, SHORT, or FLAT.\n"
            "2. Set size to a float in [0.0, 1.0] (fraction of max allowed position).\n"
            "3. Write a concise reason (one sentence).\n\n"
            'JSON schema: {"action": "LONG"|"SHORT"|"FLAT", "size": float, "reason": string}'
        )

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    def _parse_response(self, raw: str) -> Decision:
        """
        Parse and validate the LLM JSON response.
        Strips markdown fences if present before parsing.
        Raises LLMParseError on any structural problem.
        """
        # Strip ```json ... ``` fences the model sometimes adds
        cleaned = re.sub(r"```(?:json)?", "", raw).strip().strip("`").strip()

        try:
            data: Dict[str, Any] = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            raise LLMParseError(f"Invalid JSON: {exc}\nRaw: {raw!r}") from exc

        # --- action ---
        action = str(data.get("action", "")).upper()
        if action not in VALID_ACTIONS:
            raise LLMParseError(
                f"Invalid action {action!r}. Must be one of {sorted(VALID_ACTIONS)}."
            )

        # --- size ---
        try:
            size = float(data["size"])
        except (KeyError, TypeError, ValueError) as exc:
            raise LLMParseError(f"Missing or non-numeric 'size': {exc}") from exc

        lo, hi = self.size_clamp
        if not (lo <= size <= hi):
            logger.warning("LLM size %.3f outside [%.1f, %.1f]; clamping.", size, lo, hi)
            size = max(lo, min(hi, size))

        # --- reason ---
        reason = str(data.get("reason", "")).strip()
        if not reason:
            raise LLMParseError("Missing or empty 'reason' field.")

        return Decision(action=action, size=size, reason=reason, source="llm")


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------

class LLMParseError(ValueError):
    """Raised when the LLM response cannot be parsed into a valid Decision."""
