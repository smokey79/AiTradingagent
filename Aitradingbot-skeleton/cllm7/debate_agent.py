from __future__ import annotations

"""
agents/debate_agent.py

Orallexa-style Bull / Bear / Neutral agent debate.
Three LLM agents argue for and against a trade, then a
FacilitatorAgent reads the debate and returns a final
structured Decision.

Integrates with LLMRouter — each agent can use a different
provider (e.g. Bull=Anthropic, Bear=Grok, Facilitator=OpenAI).

Alan J | barcay0611@gmail.com | github: smokey79
"""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from core.llm_router import LLMRouter, LLMClient
from core.data_schema import Candle
from agents.strategy_agent import Decision

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Debate configuration
# ---------------------------------------------------------------------------

DEBATE_ROUNDS    = 2   # Each side speaks this many times before facilitator rules
MAX_REPLY_TOKENS = 400


# ---------------------------------------------------------------------------
# Individual debater
# ---------------------------------------------------------------------------

@dataclass
class DebateMessage:
    role    : str   # "bull" | "bear" | "neutral" | "facilitator"
    content : str


class DebaterAgent:
    """
    One side of the debate — bullish, bearish, or neutral.
    Generates an argument based on market context + opposing messages.
    """

    def __init__(
        self,
        role   : str,      # "bull" | "bear" | "neutral"
        llm    : LLMClient,
        llm_name: str = "anthropic",
    ) -> None:
        self.role     = role
        self.llm      = llm
        self.llm_name = llm_name

    def _system_instruction(self) -> str:
        instructions = {
            "bull": (
                "You are a BULLISH crypto trading analyst. "
                "Your job is to find and argue for long/buy opportunities. "
                "Focus on upside catalysts, support levels, positive momentum, "
                "and why the risk/reward favours entering a long position. "
                "Be concise — max 3 bullet points."
            ),
            "bear": (
                "You are a BEARISH crypto trading analyst. "
                "Your job is to identify risks, downside scenarios, and reasons "
                "to stay flat or go short. Focus on resistance levels, negative "
                "momentum, macro risks, and overvaluation. "
                "Be concise — max 3 bullet points."
            ),
            "neutral": (
                "You are a NEUTRAL risk analyst. "
                "Your job is to find the balanced view: where both bull and bear "
                "cases have merit, what the key uncertainties are, and what "
                "additional conditions would tip the decision either way. "
                "Be concise — max 3 bullet points."
            ),
        }
        return instructions.get(self.role, instructions["neutral"])

    def argue(
        self,
        candle   : Candle,
        features : Dict[str, float],
        history  : List[DebateMessage],
        learned_context: str = "",
    ) -> str:
        history_text = "\n".join(
            f"[{m.role.upper()}]: {m.content}" for m in history
        ) if history else "No prior arguments yet."

        features_text = "\n".join(
            f"  {k}: {v:.4f}" for k, v in sorted(features.items())
        )

        prompt = (
            f"{self._system_instruction()}\n\n"
            f"Symbol    : {candle.symbol}\n"
            f"Close     : {candle.close}\n"
            f"OHLC      : O={candle.open} H={candle.high} L={candle.low} C={candle.close}\n"
            f"Volume    : {candle.volume}\n\n"
            f"Features:\n{features_text}\n\n"
            f"{learned_context}\n\n"
            f"Debate so far:\n{history_text}\n\n"
            f"Your argument (respond as {self.role.upper()}):"
        )

        try:
            return self.llm.generate_text(
                prompt, max_tokens=MAX_REPLY_TOKENS, llm=self.llm_name
            )
        except Exception as exc:
            logger.warning("Debater %s failed: %s", self.role, exc)
            return f"[{self.role} argument unavailable due to LLM error]"


# ---------------------------------------------------------------------------
# Facilitator — reads full debate, emits a Decision
# ---------------------------------------------------------------------------

class FacilitatorAgent:
    """
    Reads the complete debate transcript and produces the final
    structured Decision, weighted by argument strength.
    """

    def __init__(self, llm: LLMClient, llm_name: str = "anthropic") -> None:
        self.llm      = llm
        self.llm_name = llm_name

    def decide(
        self,
        candle   : Candle,
        features : Dict[str, float],
        debate   : List[DebateMessage],
    ) -> Decision:
        transcript = "\n".join(
            f"[{m.role.upper()}]: {m.content}" for m in debate
        )

        prompt = (
            "You are a senior fund manager reviewing a trading debate.\n"
            "Based on the arguments below, make the final trading decision.\n"
            "Reply with ONLY a JSON object — no markdown, no extra text.\n\n"
            f"Symbol : {candle.symbol}  |  Close : {candle.close}\n\n"
            f"DEBATE TRANSCRIPT:\n{transcript}\n\n"
            "Your decision:\n"
            '{"action": "LONG"|"SHORT"|"FLAT", "size": 0.0-1.0, '
            '"reason": "one sentence", "bull_score": 0.0-1.0, '
            '"bear_score": 0.0-1.0, "confidence": 0.0-1.0}'
        )

        try:
            raw     = self.llm.generate_text(prompt, max_tokens=300, llm=self.llm_name)
            cleaned = re.sub(r"```(?:json)?", "", raw).strip().strip("`").strip()
            data    = json.loads(cleaned)

            action = str(data.get("action", "FLAT")).upper()
            if action not in {"LONG", "SHORT", "FLAT"}:
                action = "FLAT"

            size = max(0.0, min(1.0, float(data.get("size", 0.0))))

            return Decision(
                action    = action,
                size      = size,
                reason    = str(data.get("reason", "Debate facilitator decision.")),
                source    = "debate",
                # Extra fields carried in Decision for downstream use:
            )

        except Exception as exc:
            logger.warning("Facilitator failed: %s. Defaulting to FLAT.", exc)
            return Decision(
                action = "FLAT",
                size   = 0.0,
                reason = f"Facilitator error: {exc}",
                source = "fallback",
            )


# ---------------------------------------------------------------------------
# Debate orchestrator
# ---------------------------------------------------------------------------

class DebateOrchestrator:
    """
    Runs a full Bull / Bear / Neutral debate and returns the
    Facilitator's final Decision.

    Usage:
        orchestrator = DebateOrchestrator.from_router(router)
        decision = orchestrator.run(candle, features)
    """

    def __init__(
        self,
        bull       : DebaterAgent,
        bear       : DebaterAgent,
        neutral    : DebaterAgent,
        facilitator: FacilitatorAgent,
        rounds     : int = DEBATE_ROUNDS,
    ) -> None:
        self.bull        = bull
        self.bear        = bear
        self.neutral     = neutral
        self.facilitator = facilitator
        self.rounds      = rounds

    @classmethod
    def from_router(
        cls,
        router        : LLMRouter,
        bull_llm      : str = "anthropic",
        bear_llm      : str = "grok",
        neutral_llm   : str = "anthropic",
        facilitator_llm: str = "anthropic",
        rounds        : int = DEBATE_ROUNDS,
    ) -> "DebateOrchestrator":
        """
        Factory: wire up all four agents from a single LLMRouter.
        Each agent can use a different provider via the llm= kwarg.
        """
        return cls(
            bull        = DebaterAgent("bull",    router, bull_llm),
            bear        = DebaterAgent("bear",    router, bear_llm),
            neutral     = DebaterAgent("neutral", router, neutral_llm),
            facilitator = FacilitatorAgent(router, facilitator_llm),
            rounds      = rounds,
        )

    def run(
        self,
        candle          : Candle,
        features        : Dict[str, float],
        learned_context : str = "",
    ) -> tuple[Decision, List[DebateMessage]]:
        """
        Runs the debate and returns (Decision, full transcript).

        The transcript can be stored for audit, displayed in a dashboard,
        or fed back into the learning agent.
        """
        history: List[DebateMessage] = []

        for round_n in range(self.rounds):
            logger.debug("Debate round %d/%d for %s", round_n + 1, self.rounds, candle.symbol)

            # Bull argues
            bull_arg = self.bull.argue(candle, features, history, learned_context)
            history.append(DebateMessage("bull", bull_arg))

            # Bear responds
            bear_arg = self.bear.argue(candle, features, history, learned_context)
            history.append(DebateMessage("bear", bear_arg))

            # Neutral balances
            neutral_arg = self.neutral.argue(candle, features, history, learned_context)
            history.append(DebateMessage("neutral", neutral_arg))

        # Facilitator rules
        decision = self.facilitator.decide(candle, features, history)

        logger.info(
            "Debate result for %s: %s (size=%.2f) confidence from transcript len=%d",
            candle.symbol, decision["action"], decision["size"], len(history),
        )
        return decision, history

    def run_with_logging(
        self,
        candle  : Candle,
        features: Dict[str, float],
        learned_context: str = "",
    ) -> Decision:
        """Convenience wrapper that prints the transcript to stdout."""
        decision, history = self.run(candle, features, learned_context)
        print(f"\n{'='*70}")
        print(f"DEBATE: {candle.symbol} @ {candle.close}")
        print('='*70)
        for msg in history:
            print(f"\n[{msg.role.upper()}]\n{msg.content}")
        print(f"\n[DECISION] {decision['action']} size={decision['size']:.2f}")
        print(f"Reason: {decision['reason']}")
        print('='*70 + "\n")
        return decision
