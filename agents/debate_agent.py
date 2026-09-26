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

        # FIX 2026-09-13: an explicit llm= override makes LLMRouter skip its
        # own fallback chain entirely (core/llm_router.py _call_with_fallback:
        # chain = [primary] only when an override is passed). That meant a
        # rate-limited/out-of-credit assigned provider failed this debater
        # outright with three other working providers sitting right there.
        # Try the assigned provider first (keeps each seat's distinct voice
        # when things are healthy), then fall through to the router's full
        # default+fallback chain (which itself includes OpenRouter's own
        # free-model rotation + local Ollama/Hermes failover) before giving up.
        try:
            return self.llm.generate_text(
                prompt, max_tokens=MAX_REPLY_TOKENS, llm=self.llm_name
            )
        except Exception as exc:
            logger.warning(
                "Debater %s primary (%s) failed: %s — trying router fallback chain.",
                self.role, self.llm_name, exc,
            )
            try:
                return self.llm.generate_text(prompt, max_tokens=MAX_REPLY_TOKENS)
            except Exception as exc2:
                logger.warning("Debater %s fallback chain also failed: %s", self.role, exc2)
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

        # FIX 2026-09-13: same explicit-override-skips-fallback issue as
        # DebaterAgent.argue() above — try the assigned provider, then fall
        # through to the router's full chain before defaulting to FLAT.
        try:
            try:
                raw = self.llm.generate_text(prompt, max_tokens=300, llm=self.llm_name)
            except Exception as primary_exc:
                logger.warning(
                    "Facilitator primary (%s) failed: %s — trying router fallback chain.",
                    self.llm_name, primary_exc,
                )
                raw = self.llm.generate_text(prompt, max_tokens=300)
            if not raw:
                # FIX 2026-09-26: a provider can return an empty/None result
                # as a "successful" call (see the OpenRouter content=null fix
                # in core/llm_router.py). Treat that the same as a raised
                # error instead of letting it crash re.sub() below with a
                # confusing "expected string ... got NoneType" message.
                raise ValueError("LLM returned an empty response")
            cleaned = re.sub(r"```(?:json)?", "", raw).strip().strip("`").strip()
            if not cleaned:
                # FIX 2026-09-26: raw was non-empty (e.g. an empty ```json```
                # fence or pure whitespace/backticks) but had nothing left
                # after stripping markdown fences, so json.loads() would blow
                # up with an opaque "Expecting value: line 1 column 1" error
                # that hid what the model actually sent. Surface the original
                # raw text (truncated) so this is diagnosable from the logs
                # instead of a dead end every time it happens.
                raise ValueError(
                    f"LLM response had no JSON content after stripping markdown "
                    f"fences (raw={raw[:200]!r})"
                )
            try:
                data = json.loads(cleaned)
            except json.JSONDecodeError:
                # FIX 2026-09-26: free OpenRouter models routinely ignore the
                # "reply with ONLY a JSON object" instruction and "think out
                # loud" first (e.g. "Let me analyze the debate transcript...
                # {"action": "LONG", ...}"). That made json.loads() fail on
                # every single cycle where a free model answered the
                # facilitator seat, silently defaulting every decision to
                # FLAT regardless of what the bull/bear/neutral debate
                # actually concluded. Recover by pulling out the {...} block
                # embedded in the prose instead of requiring the whole reply
                # to be pure JSON.
                match = re.search(r"\{.*\}", cleaned, re.DOTALL)
                if not match:
                    raise ValueError(
                        f"No JSON object found in LLM response "
                        f"(cleaned={cleaned[:200]!r})"
                    )
                try:
                    data = json.loads(match.group(0))
                except json.JSONDecodeError as json_exc:
                    raise ValueError(
                        f"{json_exc} (extracted={match.group(0)[:200]!r})"
                    ) from json_exc

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
        bull_llm      : str = "openrouter",
        bear_llm      : str = "openrouter",
        neutral_llm   : str = "gemini",
        facilitator_llm: str = "openrouter",
        rounds        : int = DEBATE_ROUNDS,
    ) -> "DebateOrchestrator":
        """
        Factory: wire up all four agents from a single LLMRouter.
        Each agent can use a different provider via the llm= kwarg.

        FIX 2026-09-13: was defaulting every seat to anthropic/grok. Passing
        an explicit `llm=` override makes LLMRouter skip its fallback chain
        entirely (see core/llm_router.py _call_with_fallback), so once the
        Anthropic key ran out of API credit (confirmed separate from your
        Claude Pro/Max subscription) and the xAI key started 403ing, every
        debater and the facilitator failed outright every round with no
        fallback — even though Gemini and OpenRouter were both wired up and
        working the whole time. Switched the defaults to your actual working,
        free-tier-first line-up. OpenRouter is primary for bull/bear/
        facilitator — it already rotates across 7 free models and falls
        back to local Ollama/Hermes on its own, so it absorbs the most call
        volume without hitting a single-provider rate limit. Gemini's free
        tier is capped at 20 requests/day per model (confirmed by hitting
        that limit during testing), so it's used sparingly here (neutral
        only) rather than as the default for 3 of 4 seats. Each seat also
        now falls through to the router's own full chain on failure (see
        argue()/decide() above), so a quota hit on one provider no longer
        fails that seat outright. Anthropic/Grok stay wired into the router
        as further fallback links and can still be requested directly with
        `llm="anthropic"` / `llm="grok"` once those keys are funded / fixed.
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
