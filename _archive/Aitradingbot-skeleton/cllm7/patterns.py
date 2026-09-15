from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from core.data_schema import Candle

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

class PatternName(str, Enum):
    DOUBLE_TOP      = "double_top"
    DOUBLE_BOTTOM   = "double_bottom"
    HEAD_SHOULDERS  = "head_shoulders"
    TRIANGLE        = "triangle"


class Bias(str, Enum):
    """Expected directional bias of a pattern."""
    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"


# Bias lookup — drives whether we test TP/SL from the long or short side
_PATTERN_BIAS: Dict[PatternName, Bias] = {
    PatternName.DOUBLE_TOP     : Bias.BEARISH,
    PatternName.DOUBLE_BOTTOM  : Bias.BULLISH,
    PatternName.HEAD_SHOULDERS : Bias.BEARISH,
    PatternName.TRIANGLE       : Bias.NEUTRAL,
}


@dataclass
class PatternMatch:
    """A single detected pattern occurrence."""
    index   : int          # candle index where the pattern completes
    name    : PatternName
    bias    : Bias
    meta    : Dict[str, Any] = field(default_factory=dict)  # e.g. neckline price


@dataclass
class PatternStat:
    name          : PatternName
    count         : int
    wins          : int
    losses        : int
    whipsaws      : int     # both TP and SL hit in lookahead window
    timeouts      : int     # neither hit
    win_rate      : float   # wins / (wins + losses)
    avg_r_multiple: float


# ---------------------------------------------------------------------------
# Detection  (stubs — implement per pattern)
# ---------------------------------------------------------------------------

def detect_patterns(candles: List[Candle]) -> List[PatternMatch]:
    """
    Scan a candle series and return all detected pattern completions.

    Each detector function below should append to `matches` when its
    condition is met.  Pass the full series so detectors can look back
    as many bars as they need.

    Args:
        candles: Validated, time-sorted Candle objects.

    Returns:
        List of PatternMatch sorted by index ascending.
    """
    if len(candles) < 5:
        logger.warning("detect_patterns: need ≥ 5 candles, got %d.", len(candles))
        return []

    matches: List[PatternMatch] = []

    _detect_double_bottom(candles, matches)
    _detect_double_top(candles, matches)
    # _detect_head_shoulders(candles, matches)   # TODO
    # _detect_triangle(candles, matches)         # TODO

    matches.sort(key=lambda m: m.index)
    logger.info("detect_patterns: found %d pattern(s) in %d candles.", len(matches), len(candles))
    return matches


def _detect_double_bottom(candles: List[Candle], out: List[PatternMatch]) -> None:
    """
    Stub: mark a double-bottom where two local lows are within 1 % of each other
    and separated by at least 3 bars.

    TODO: add neckline break confirmation.
    """
    lows = [c.low for c in candles]
    for i in range(3, len(lows) - 1):
        for j in range(i - 3, max(i - 20, -1), -1):
            if j < 0:
                break
            if abs(lows[i] - lows[j]) / lows[j] < 0.01:
                out.append(PatternMatch(
                    index = i,
                    name  = PatternName.DOUBLE_BOTTOM,
                    bias  = Bias.BULLISH,
                    meta  = {"left_index": j, "right_index": i},
                ))
                break  # one match per right-low


def _detect_double_top(candles: List[Candle], out: List[PatternMatch]) -> None:
    """
    Stub: mirror of double-bottom using highs.

    TODO: add neckline break confirmation.
    """
    highs = [c.high for c in candles]
    for i in range(3, len(highs) - 1):
        for j in range(i - 3, max(i - 20, -1), -1):
            if j < 0:
                break
            if abs(highs[i] - highs[j]) / highs[j] < 0.01:
                out.append(PatternMatch(
                    index = i,
                    name  = PatternName.DOUBLE_TOP,
                    bias  = Bias.BEARISH,
                    meta  = {"left_index": j, "right_index": i},
                ))
                break


# ---------------------------------------------------------------------------
# Backtesting
# ---------------------------------------------------------------------------

def backtest_patterns(
    candles          : List[Candle],
    patterns         : List[PatternMatch],
    lookahead_bars   : int   = 20,
    profit_threshold : float = 0.02,
    stop_threshold   : float = 0.01,
) -> List[PatternStat]:
    """
    Simulate forward outcomes for each detected pattern.

    For BULLISH patterns: TP = entry * (1 + profit_threshold),
                          SL = entry * (1 - stop_threshold).
    For BEARISH patterns: TP = entry * (1 - profit_threshold),
                          SL = entry * (1 + stop_threshold).
    NEUTRAL patterns use the long-bias calculation.

    Args:
        candles:           Full candle series (same as passed to detect_patterns).
        patterns:          Output of detect_patterns.
        lookahead_bars:    How many bars forward to check TP/SL.
        profit_threshold:  Fraction gain to count as a win  (must be > 0).
        stop_threshold:    Fraction loss to count as a loss (must be > 0).

    Returns:
        One PatternStat per PatternName that appeared in `patterns`.
    """
    if stop_threshold <= 0 or profit_threshold <= 0:
        raise ValueError(
            f"profit_threshold and stop_threshold must both be > 0, "
            f"got profit={profit_threshold}, stop={stop_threshold}."
        )

    r_ratio = profit_threshold / stop_threshold

    # Accumulator keyed by PatternName
    acc: Dict[PatternName, Dict[str, int | float]] = {}

    for match in patterns:
        idx  = match.index
        name = match.name

        if idx < 0 or idx >= len(candles):
            logger.warning("Pattern %s has out-of-bounds index %d — skipping.", name, idx)
            continue

        fwd = candles[idx + 1 : idx + 1 + lookahead_bars]
        if not fwd:
            logger.debug(
                "Pattern %s at index %d has no forward bars — skipping.", name, idx
            )
            continue

        entry    = candles[idx].close
        high_fwd = max(c.high for c in fwd)
        low_fwd  = min(c.low  for c in fwd)

        bullish = match.bias in (Bias.BULLISH, Bias.NEUTRAL)
        if bullish:
            hit_tp = (high_fwd - entry) / entry >= profit_threshold
            hit_sl = (entry - low_fwd)  / entry >= stop_threshold
        else:
            hit_tp = (entry - low_fwd)  / entry >= profit_threshold
            hit_sl = (high_fwd - entry) / entry >= stop_threshold

        if name not in acc:
            acc[name] = {"count": 0, "wins": 0, "losses": 0,
                         "whipsaws": 0, "timeouts": 0, "r_sum": 0.0}

        a = acc[name]
        a["count"] += 1

        if hit_tp and hit_sl:
            # Whipsaw: assume SL hit first (conservative)
            a["whipsaws"] += 1
            a["losses"]   += 1
            a["r_sum"]    -= 1.0
            logger.debug("Whipsaw on %s at index %d.", name, idx)
        elif hit_tp:
            a["wins"]  += 1
            a["r_sum"] += r_ratio
        elif hit_sl:
            a["losses"] += 1
            a["r_sum"]  -= 1.0
        else:
            a["timeouts"] += 1
            # 0R — neither threshold reached in lookahead window

    result: List[PatternStat] = []
    for name, a in acc.items():
        decided = a["wins"] + a["losses"]   # excludes timeouts from win-rate
        win_rate = a["wins"] / decided if decided else 0.0
        avg_r    = a["r_sum"] / a["count"] if a["count"] else 0.0
        result.append(PatternStat(
            name           = name,
            count          = a["count"],
            wins           = a["wins"],
            losses         = a["losses"],
            whipsaws       = a["whipsaws"],
            timeouts       = a["timeouts"],
            win_rate       = win_rate,
            avg_r_multiple = avg_r,
        ))

    result.sort(key=lambda s: s.avg_r_multiple, reverse=True)
    return result
