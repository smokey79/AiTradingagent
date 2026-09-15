"""
ConsensusEngine — collects votes from all 6 agents, applies the 70% (>=4/6) threshold.
Aggregates constraints (tightest wins for safety), logs result.
Tokens: BTC, ETH, CRO, SOL, AVAX, ARB, OP
Alan's rules:
  - Consensus threshold: >=4 of 6 agents must agree on same signal
  - Max leverage: 5x
  - Paper mode by default
  - 80% win rate over 20 trades required before live funds
"""
import logging
from typing import Dict, List
from statistics import mean

logger = logging.getLogger(__name__)

CONSENSUS_THRESHOLD = 4   # out of 6 agents
TOTAL_AGENTS = 6
TARGET_TOKENS = ["BTC", "ETH", "CRO", "SOL", "AVAX", "ARB", "OP"]
MAX_LEVERAGE = 5.0
VALID_SIGNALS = {"BUY", "SELL", "HOLD"}


def run_consensus(agent_results: Dict[str, dict], symbol: str) -> dict:
    """
    agent_results: { "claude": {...}, "gpt4o": {...}, "gemini": {...},
                     "grok": {...}, "hermes": {...}, "openrouter": {...} }

    Returns:
    {
      "symbol": "BTC",
      "final_signal": "BUY"|"SELL"|"HOLD",
      "consensus_reached": bool,
      "vote_count": int,
      "vote_tally": {"BUY": 2, "SELL": 1, "HOLD": 3},
      "avg_confidence": float,
      "constraints": { "max_position_pct", "stop_loss_pct", "take_profit_pct" },
      "agent_breakdown": { agent_name: signal }
    }
    """
    vote_tally = {"BUY": 0, "SELL": 0, "HOLD": 0}
    confidence_scores = []
    constraints_list = []
    agent_breakdown = {}

    for agent_name, result in agent_results.items():
        signal = result.get("signal", "HOLD").upper()
        if signal not in VALID_SIGNALS:
            signal = "HOLD"
        confidence = float(result.get("confidence", 0.0))
        constraints = result.get("constraints", {})

        vote_tally[signal] += 1
        confidence_scores.append(confidence)
        constraints_list.append(constraints)
        agent_breakdown[agent_name] = signal

    # Find winning signal
    winning_signal = max(vote_tally, key=vote_tally.get)
    vote_count = vote_tally[winning_signal]
    consensus_reached = vote_count >= CONSENSUS_THRESHOLD

    # If no consensus, force HOLD (risk gate)
    final_signal = winning_signal if consensus_reached else "HOLD"

    # Tightest constraints win (safety first)
    merged_constraints = _tightest_constraints(constraints_list)

    avg_confidence = mean(confidence_scores) if confidence_scores else 0.0

    result = {
        "symbol": symbol,
        "final_signal": final_signal,
        "consensus_reached": consensus_reached,
        "vote_count": vote_count,
        "vote_tally": vote_tally,
        "avg_confidence": round(avg_confidence, 3),
        "constraints": merged_constraints,
        "agent_breakdown": agent_breakdown
    }

    if consensus_reached:
        logger.info(f"[CONSENSUS] {symbol}: {final_signal} ({vote_count}/{TOTAL_AGENTS}) "
                    f"confidence={avg_confidence:.2f}")
    else:
        logger.warning(f"[NO CONSENSUS] {symbol}: best={winning_signal} ({vote_count}/{TOTAL_AGENTS}) "
                       f"→ forcing HOLD")
    return result


def _tightest_constraints(constraints_list: List[dict]) -> dict:
    """
    Safety-first: smallest position size, tightest stop, lowest take-profit.
    """
    if not constraints_list:
        return {"max_position_pct": 2.0, "stop_loss_pct": 2.0, "take_profit_pct": 5.0}

    positions = [c.get("max_position_pct", 5.0) for c in constraints_list if c]
    stops = [c.get("stop_loss_pct", 2.0) for c in constraints_list if c]
    takes = [c.get("take_profit_pct", 5.0) for c in constraints_list if c]

    return {
        "max_position_pct": round(min(positions), 2),
        "stop_loss_pct": round(min(stops), 2),
        "take_profit_pct": round(min(takes), 2)
    }
