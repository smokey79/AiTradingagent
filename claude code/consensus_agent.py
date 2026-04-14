from __future__ import annotations

"""
agents/consensus_agent.py

Multi-LLM majority-vote decision engine.

Runs the SAME trade prompt through every available AI simultaneously
(Claude, OpenAI, Grok) using parallel threads, collects each decision,
applies weighted majority vote, and returns a single ConsensusDecision.

Why this matters:
  - No single AI is always right
  - Agreement between 3 independent models = much higher confidence
  - Disagreement = stay out / hold — protects capital
  - Each AI's reasoning is logged for post-trade analysis

Flow:
  ┌──────────────┐
  │  TradePrompt │
  └──────┬───────┘
         │ (parallel threads)
  ┌──────┴───────────────────────────────┐
  │         │              │             │
  ▼         ▼              ▼             ▼
Claude    OpenAI          Grok     (future AIs)
  │         │              │
  └─────────┴──────────────┘
            │
      VoteAggregator
            │
    ConsensusDecision
"""

import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed, Future
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Tuple

from core.llm_router import LLMRouter, LLMClient
from core.config import get_settings, ActiveLLM
from core.data_schema import Candle
from analytics.patterns import PatternMatch
from agents.sentiment_agent import AggregatedSentiment, SentimentAgent

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

class Action(str, Enum):
    BUY  = "buy"
    SELL = "sell"
    HOLD = "hold"


class Confidence(str, Enum):
    HIGH   = "high"    # weight = 3
    MEDIUM = "medium"  # weight = 2
    LOW    = "low"     # weight = 1


# Confidence → numeric weight for vote tallying
CONFIDENCE_WEIGHT: Dict[Confidence, int] = {
    Confidence.HIGH  : 3,
    Confidence.MEDIUM: 2,
    Confidence.LOW   : 1,
}


@dataclass
class AIVote:
    """One AI model's individual decision."""
    provider     : str            # "anthropic" | "openai" | "grok"
    action       : Action
    confidence   : Confidence
    take_profit  : Optional[float]
    stop_loss    : Optional[float]
    reasoning    : str
    elapsed_ms   : int            # how long this AI took
    error        : Optional[str] = None   # set if the AI failed


@dataclass
class ConsensusDecision:
    """Final aggregated decision from all AIs."""

    # ── Core output ────────────────────────────────────────────────────────
    action          : Action
    confidence      : Confidence
    take_profit     : Optional[float]
    stop_loss       : Optional[float]
    consensus_score : float      # 0.0 – 1.0  (1.0 = all AIs agree perfectly)
    consensus_reached: bool      # True if ≥ threshold agree

    # ── Per-AI breakdown ──────────────────────────────────────────────────
    votes           : List[AIVote]
    vote_tally      : Dict[str, int]   # {"buy": 6, "sell": 0, "hold": 2}
    winner_votes    : int
    total_votes     : int

    # ── Sentiment context ─────────────────────────────────────────────────
    sentiment_bias  : str
    sentiment_score : float

    # ── Human-readable summary ────────────────────────────────────────────
    summary         : str


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------

def _build_trade_prompt(
    asset    : str,
    candles  : List[Candle],
    patterns : List[PatternMatch],
    sentiment: AggregatedSentiment,
) -> str:
    """Builds the shared prompt sent to ALL AIs."""

    recent = candles[-10:]
    candle_lines = "\n".join(
        f"  {c.timestamp.date()}  "
        f"O:{c.open:.2f}  H:{c.high:.2f}  L:{c.low:.2f}  "
        f"C:{c.close:.2f}  V:{c.volume:.0f}"
        for c in recent
    )

    pattern_lines = (
        "\n".join(
            f"  {p.name.value}  bias:{p.bias}  "
            f"tp:{p.take_profit}  sl:{p.stop_loss}"
            for p in patterns
        )
        if patterns else "  None detected"
    )

    signal_lines = "\n".join(
        f"  [{s.source}] {s.bias.value}  "
        f"conf:{s.confidence:.2f}  — {s.summary}"
        for s in sentiment.signals
    ) if sentiment.signals else "  No signals"

    return f"""
You are an expert crypto trading strategist. Analyse the data below for {asset}.
Reply with ONLY a valid JSON object — no markdown, no extra text.

=== PRICE DATA (last 10 candles) ===
{candle_lines}

=== CHART PATTERNS ===
{pattern_lines}

=== MARKET SENTIMENT (score {sentiment.overall_score:+.2f} / overall: {sentiment.overall_bias.value}) ===
{signal_lines}

=== YOUR TASK ===
Return exactly this JSON structure:
{{
  "action"      : "buy" | "sell" | "hold",
  "confidence"  : "high" | "medium" | "low",
  "take_profit" : <float or null>,
  "stop_loss"   : <float or null>,
  "reasoning"   : "<max 30 words explaining your decision>"
}}

Decision rules:
- sentiment score < -0.5  → strongly avoid buy unless pattern is extremely clear
- sentiment score > +0.5  → prefer buy over hold if technicals support it
- futures funding rate signal takes priority over news sentiment
- Only set take_profit / stop_loss for buy or sell — use null for hold
- Be decisive — avoid hold unless genuinely unclear
""".strip()


# ---------------------------------------------------------------------------
# Single-AI caller  (runs in its own thread)
# ---------------------------------------------------------------------------

def _call_single_ai(
    provider  : str,
    client    : LLMClient,
    prompt    : str,
) -> AIVote:
    """
    Calls one AI provider with the trade prompt.
    Parses the JSON response into an AIVote.
    Never raises — errors are captured in AIVote.error.
    """
    start = time.time()
    try:
        raw     = client.generate_text(prompt)
        elapsed = int((time.time() - start) * 1000)

        # Strip markdown fences if AI wraps in ```json ... ```
        clean = re.sub(r"```(?:json)?|```", "", raw).strip()
        match = re.search(r"\{.*\}", clean, re.S)
        if not match:
            raise ValueError(f"No JSON found in response: {raw!r}")

        data = json.loads(match.group())

        return AIVote(
            provider    = provider,
            action      = Action(data["action"]),
            confidence  = Confidence(data["confidence"]),
            take_profit = data.get("take_profit"),
            stop_loss   = data.get("stop_loss"),
            reasoning   = data.get("reasoning", ""),
            elapsed_ms  = elapsed,
        )

    except Exception as exc:
        elapsed = int((time.time() - start) * 1000)
        logger.warning("[ConsensusAgent] %s failed: %s", provider, exc)
        return AIVote(
            provider    = provider,
            action      = Action.HOLD,      # safe default on failure
            confidence  = Confidence.LOW,
            take_profit = None,
            stop_loss   = None,
            reasoning   = f"AI unavailable: {exc}",
            elapsed_ms  = elapsed,
            error       = str(exc),
        )


# ---------------------------------------------------------------------------
# Vote aggregator
# ---------------------------------------------------------------------------

def _aggregate_votes(
    votes           : List[AIVote],
    sentiment       : AggregatedSentiment,
    min_agreement   : float = 0.5,   # fraction of weighted votes needed to win
) -> Tuple[Action, Confidence, float, bool, Dict[str, int]]:
    """
    Weighted majority vote across all AI decisions.

    Weight per vote = CONFIDENCE_WEIGHT[confidence]
    e.g.  Claude says BUY  high   → +3 for BUY
          OpenAI says BUY  medium → +2 for BUY
          Grok   says HOLD low    → +1 for HOLD
          → BUY wins 5:1

    Returns:
        (winning_action, aggregated_confidence, consensus_score,
         consensus_reached, tally_dict)
    """
    tally: Dict[str, int] = {a.value: 0 for a in Action}
    total_weight = 0

    for v in votes:
        w = CONFIDENCE_WEIGHT[v.confidence]
        tally[v.action.value] += w
        total_weight          += w

    if total_weight == 0:
        return Action.HOLD, Confidence.LOW, 0.0, False, tally

    # Find winner
    winner_action_str = max(tally, key=lambda k: tally[k])
    winner_weight     = tally[winner_action_str]
    winner_action     = Action(winner_action_str)

    # Consensus score = winner's share of total weight
    consensus_score   = winner_weight / total_weight
    consensus_reached = consensus_score >= min_agreement

    # Sentiment tie-break — if two actions are tied use sentiment
    top_two = sorted(tally.items(), key=lambda x: x[1], reverse=True)[:2]
    if len(top_two) == 2 and top_two[0][1] == top_two[1][1]:
        logger.info("[ConsensusAgent] Tie detected — using sentiment as tiebreaker")
        if sentiment.overall_score > 0.2:
            winner_action = Action.BUY
        elif sentiment.overall_score < -0.2:
            winner_action = Action.SELL
        else:
            winner_action = Action.HOLD

    # Aggregate confidence
    # → high if consensus ≥ 0.75, medium if ≥ 0.5, low otherwise
    if consensus_score >= 0.75:
        agg_confidence = Confidence.HIGH
    elif consensus_score >= 0.50:
        agg_confidence = Confidence.MEDIUM
    else:
        agg_confidence = Confidence.LOW

    return winner_action, agg_confidence, consensus_score, consensus_reached, tally


# ---------------------------------------------------------------------------
# TP / SL aggregator
# ---------------------------------------------------------------------------

def _aggregate_tp_sl(
    votes : List[AIVote],
    action: Action,
) -> Tuple[Optional[float], Optional[float]]:
    """
    Averages take_profit and stop_loss across all AIs that agree
    with the winning action.
    """
    agreeing = [v for v in votes if v.action == action and not v.error]
    tps = [v.take_profit for v in agreeing if v.take_profit is not None]
    sls = [v.stop_loss   for v in agreeing if v.stop_loss   is not None]

    avg_tp = round(sum(tps) / len(tps), 2) if tps else None
    avg_sl = round(sum(sls) / len(sls), 2) if sls else None
    return avg_tp, avg_sl


# ---------------------------------------------------------------------------
# ConsensusAgent
# ---------------------------------------------------------------------------

class ConsensusAgent:
    """
    Runs every available LLM in parallel, collects votes,
    returns a single ConsensusDecision.

    Usage:
        agent    = ConsensusAgent.from_config()
        decision = agent.decide(
            asset    = "BTC",
            candles  = candle_list,
            patterns = pattern_list,
        )

        # What did each AI say?
        for vote in decision.votes:
            print(f"{vote.provider}: {vote.action} ({vote.confidence}) — {vote.reasoning}")

        # Final answer
        print(decision.action, decision.consensus_score)
    """

    def __init__(
        self,
        router          : LLMRouter,
        sentiment_agent : SentimentAgent,
        min_agreement   : float = 0.5,    # fraction of weighted votes to reach consensus
        max_workers     : int   = 5,      # parallel threads
    ) -> None:
        self.router          = router
        self.sentiment_agent = sentiment_agent
        self.min_agreement   = min_agreement
        self.max_workers     = max_workers

    @classmethod
    def from_config(cls) -> "ConsensusAgent":
        router          = LLMRouter.from_config()
        sentiment_agent = SentimentAgent.from_config()
        return cls(router=router, sentiment_agent=sentiment_agent)

    # ------------------------------------------------------------------
    # Internal: run all AIs in parallel
    # ------------------------------------------------------------------

    def _poll_all_ais(self, prompt: str) -> List[AIVote]:
        """
        Fires every registered LLM client simultaneously in separate threads.
        Collects results as they come in (fastest AI first).
        """
        votes: List[AIVote] = []

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures: Dict[Future, str] = {
                executor.submit(_call_single_ai, provider, client, prompt): provider
                for provider, client in self.router.clients.items()
            }

            for future in as_completed(futures):
                provider = futures[future]
                try:
                    vote = future.result()
                    votes.append(vote)
                    status = "❌ ERROR" if vote.error else f"✅ {vote.action.value.upper()}"
                    logger.info(
                        "[ConsensusAgent] %s → %s  conf:%s  %dms",
                        provider, status, vote.confidence.value, vote.elapsed_ms
                    )
                except Exception as exc:
                    logger.error("[ConsensusAgent] Thread error for %s: %s", provider, exc)

        return votes

    # ------------------------------------------------------------------
    # Internal: build human-readable summary
    # ------------------------------------------------------------------

    @staticmethod
    def _build_summary(
        votes           : List[AIVote],
        action          : Action,
        confidence      : Confidence,
        consensus_score : float,
        consensus_reached: bool,
        tally           : Dict[str, int],
    ) -> str:
        lines = [
            f"{'✅ CONSENSUS' if consensus_reached else '⚠️  NO CONSENSUS'} "
            f"— Final: {action.value.upper()} "
            f"({confidence.value}, score={consensus_score:.0%})",
            "",
            "Individual AI votes:",
        ]
        for v in votes:
            err_tag = f" [ERROR: {v.error}]" if v.error else ""
            lines.append(
                f"  {v.provider:<12} → {v.action.value:<5}  "
                f"conf:{v.confidence.value:<7}  "
                f"{v.elapsed_ms}ms{err_tag}"
                f"\n               reasoning: {v.reasoning}"
            )
        lines += [
            "",
            f"Vote tally (weighted): "
            + "  ".join(f"{k}={v}" for k, v in tally.items() if v > 0),
        ]
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def decide(
        self,
        asset      : str,
        candles    : List[Candle],
        patterns   : List[PatternMatch],
        symbol     : str           = "BTCUSDT",
        video_ids  : List[str]     = None,
        news_query : Optional[str] = None,
        use_futures: bool          = True,
    ) -> ConsensusDecision:

        if not candles:
            raise ValueError("At least one candle is required.")

        # ── Step 1: Gather sentiment ───────────────────────────────────
        logger.info("[ConsensusAgent] Gathering sentiment for %s...", asset)
        sentiment = self.sentiment_agent.analyse(
            asset       = asset,
            symbol      = symbol,
            video_ids   = video_ids  or [],
            news_query  = news_query or f"{asset} price news",
            use_futures = use_futures,
        )

        # ── Step 2: Build shared prompt ────────────────────────────────
        prompt = _build_trade_prompt(asset, candles, patterns, sentiment)

        # ── Step 3: Poll all AIs in parallel ───────────────────────────
        logger.info(
            "[ConsensusAgent] Polling %d AIs in parallel...",
            len(self.router.clients)
        )
        votes = self._poll_all_ais(prompt)

        if not votes:
            logger.error("[ConsensusAgent] No votes collected — all AIs failed.")
            return self._safe_hold(sentiment)

        # ── Step 4: Aggregate votes ────────────────────────────────────
        action, confidence, consensus_score, consensus_reached, tally = \
            _aggregate_votes(votes, sentiment, self.min_agreement)

        # ── Step 5: Average TP / SL from agreeing AIs ──────────────────
        take_profit, stop_loss = _aggregate_tp_sl(votes, action)

        # ── Step 6: Build summary ──────────────────────────────────────
        summary = self._build_summary(
            votes, action, confidence, consensus_score, consensus_reached, tally
        )
        logger.info("\n%s", summary)

        return ConsensusDecision(
            action           = action,
            confidence       = confidence,
            take_profit      = take_profit,
            stop_loss        = stop_loss,
            consensus_score  = round(consensus_score, 4),
            consensus_reached= consensus_reached,
            votes            = votes,
            vote_tally       = tally,
            winner_votes     = tally[action.value],
            total_votes      = sum(tally.values()),
            sentiment_bias   = sentiment.overall_bias.value,
            sentiment_score  = sentiment.overall_score,
            summary          = summary,
        )

    # ------------------------------------------------------------------
    # Safe fallback
    # ------------------------------------------------------------------

    def _safe_hold(self, sentiment: AggregatedSentiment) -> ConsensusDecision:
        return ConsensusDecision(
            action           = Action.HOLD,
            confidence       = Confidence.LOW,
            take_profit      = None,
            stop_loss        = None,
            consensus_score  = 0.0,
            consensus_reached= False,
            votes            = [],
            vote_tally       = {"buy": 0, "sell": 0, "hold": 0},
            winner_votes     = 0,
            total_votes      = 0,
            sentiment_bias   = sentiment.overall_bias.value,
            sentiment_score  = sentiment.overall_score,
            summary          = "HOLD — all AI providers failed to respond.",
        )
