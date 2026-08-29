from __future__ import annotations

"""
analytics/walk_forward.py

Walk-forward validation + Monte Carlo robustness testing.
Inspired by Orallexa's validation harness.

Walk-forward:
  Splits candle history into rolling in-sample / out-of-sample windows.
  Trains (optimises) strategy on in-sample, tests on out-of-sample.
  Prevents curve-fitting by ensuring the strategy never sees future data.

Monte Carlo:
  Shuffles the trade PnL sequence N times and measures:
  - Worst-case drawdown distribution
  - Win-rate confidence interval
  - Probability of ruin

Alan J | barcay0611@gmail.com | github: smokey79
"""

import logging
import random
import statistics
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple

from core.data_schema import Candle

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class WindowResult:
    window_id       : int
    train_start     : str
    train_end       : str
    test_start      : str
    test_end        : str
    train_win_rate  : float
    test_win_rate   : float
    test_pnl_pct    : float
    test_max_dd     : float
    test_trades     : int
    passed          : bool   # test win_rate >= threshold


@dataclass
class MonteCarloResult:
    simulations         : int
    mean_win_rate       : float
    win_rate_5th_pct    : float   # worst 5% of outcomes
    win_rate_95th_pct   : float   # best 5% of outcomes
    mean_max_drawdown   : float
    worst_max_drawdown  : float
    prob_ruin           : float   # fraction of sims where drawdown > 50%
    recommendation      : str     # "robust" | "marginal" | "fragile"


@dataclass
class ValidationReport:
    total_windows       : int
    passed_windows      : int
    pass_rate           : float
    avg_test_win_rate   : float
    avg_test_pnl_pct    : float
    avg_test_max_dd     : float
    window_results      : List[WindowResult]
    monte_carlo         : Optional[MonteCarloResult]
    overall_verdict     : str   # "PASS" | "WARN" | "FAIL"


# ---------------------------------------------------------------------------
# Walk-forward engine
# ---------------------------------------------------------------------------

StrategyFn = Callable[[List[Candle], Dict[str, Any]], List[Dict[str, Any]]]
# A strategy function takes (candles, params) → list of trade dicts
# Each trade dict must have: {"was_correct": bool, "pnl_pct": float}


class WalkForwardValidator:
    """
    Splits candles into rolling windows and tests strategy stability.

    Args:
        train_size: Number of candles in the in-sample training window.
        test_size:  Number of candles in the out-of-sample test window.
        step_size:  How many candles to advance the window each iteration.
        min_win_rate: Minimum acceptable test win rate per window.
    """

    def __init__(
        self,
        train_size   : int   = 200,
        test_size    : int   = 50,
        step_size    : int   = 50,
        min_win_rate : float = 0.55,
    ) -> None:
        self.train_size   = train_size
        self.test_size    = test_size
        self.step_size    = step_size
        self.min_win_rate = min_win_rate

    def run(
        self,
        candles     : List[Candle],
        strategy_fn : StrategyFn,
        params      : Dict[str, Any],
    ) -> ValidationReport:
        """
        Runs the full walk-forward validation loop.

        Args:
            candles:     Full historical candle series, sorted ascending.
            strategy_fn: Function matching StrategyFn signature.
            params:      Strategy hyper-parameters dict.

        Returns:
            ValidationReport with per-window results and overall verdict.
        """
        window_results: List[WindowResult] = []
        window_id = 0
        pos = 0

        while pos + self.train_size + self.test_size <= len(candles):
            train = candles[pos : pos + self.train_size]
            test  = candles[pos + self.train_size : pos + self.train_size + self.test_size]

            # Train — get win rate on in-sample
            train_trades  = strategy_fn(train, params)
            train_win_rate = self._win_rate(train_trades)

            # Test — get win rate on out-of-sample (no param changes allowed)
            test_trades  = strategy_fn(test, params)
            test_win_rate = self._win_rate(test_trades)
            test_pnl     = sum(t.get("pnl_pct", 0.0) for t in test_trades)
            test_max_dd  = self._max_drawdown(test_trades)
            passed       = test_win_rate >= self.min_win_rate

            result = WindowResult(
                window_id      = window_id,
                train_start    = train[0].timestamp.isoformat(),
                train_end      = train[-1].timestamp.isoformat(),
                test_start     = test[0].timestamp.isoformat(),
                test_end       = test[-1].timestamp.isoformat(),
                train_win_rate = round(train_win_rate, 4),
                test_win_rate  = round(test_win_rate,  4),
                test_pnl_pct   = round(test_pnl,  4),
                test_max_dd    = round(test_max_dd, 4),
                test_trades    = len(test_trades),
                passed         = passed,
            )
            window_results.append(result)
            logger.info(
                "Window %d: train_wr=%.1f%% test_wr=%.1f%% dd=%.1f%% %s",
                window_id, train_win_rate * 100, test_win_rate * 100,
                test_max_dd * 100, "✅" if passed else "❌"
            )

            pos += self.step_size
            window_id += 1

        if not window_results:
            logger.warning("Not enough candles for walk-forward (need %d, got %d).",
                           self.train_size + self.test_size, len(candles))
            return ValidationReport(0, 0, 0.0, 0.0, 0.0, 0.0, [], None, "FAIL")

        passed_count = sum(1 for w in window_results if w.passed)
        pass_rate    = passed_count / len(window_results)
        avg_wr       = statistics.mean(w.test_win_rate for w in window_results)
        avg_pnl      = statistics.mean(w.test_pnl_pct  for w in window_results)
        avg_dd       = statistics.mean(w.test_max_dd   for w in window_results)

        verdict = "PASS" if pass_rate >= 0.70 else ("WARN" if pass_rate >= 0.50 else "FAIL")

        return ValidationReport(
            total_windows    = len(window_results),
            passed_windows   = passed_count,
            pass_rate        = round(pass_rate, 4),
            avg_test_win_rate= round(avg_wr,  4),
            avg_test_pnl_pct = round(avg_pnl, 4),
            avg_test_max_dd  = round(avg_dd,  4),
            window_results   = window_results,
            monte_carlo      = None,   # populated separately
            overall_verdict  = verdict,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _win_rate(trades: List[Dict]) -> float:
        if not trades:
            return 0.0
        return sum(1 for t in trades if t.get("was_correct")) / len(trades)

    @staticmethod
    def _max_drawdown(trades: List[Dict]) -> float:
        if not trades:
            return 0.0
        equity = 1.0
        peak   = 1.0
        max_dd = 0.0
        for t in trades:
            equity *= (1 + t.get("pnl_pct", 0.0) / 100)
            if equity > peak:
                peak = equity
            dd = (peak - equity) / peak
            if dd > max_dd:
                max_dd = dd
        return max_dd


# ---------------------------------------------------------------------------
# Monte Carlo stress test
# ---------------------------------------------------------------------------

class MonteCarloTester:
    """
    Shuffles the historical trade sequence N times to estimate the
    distribution of possible outcomes.  Measures worst-case drawdown
    and probability of ruin independent of trade ordering.
    """

    def __init__(self, n_simulations: int = 1000, ruin_threshold: float = 0.50) -> None:
        self.n_simulations  = n_simulations
        self.ruin_threshold = ruin_threshold

    def run(self, trades: List[Dict[str, Any]]) -> MonteCarloResult:
        """
        Args:
            trades: List of trade dicts with at least "was_correct" and "pnl_pct".
        """
        if not trades:
            logger.warning("Monte Carlo: no trades provided.")
            return MonteCarloResult(0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, "fragile")

        pnl_sequence = [t.get("pnl_pct", 0.0) for t in trades]
        win_flags    = [t.get("was_correct", False) for t in trades]
        n = len(pnl_sequence)

        sim_win_rates: List[float] = []
        sim_max_dds  : List[float] = []
        ruin_count   = 0

        for _ in range(self.n_simulations):
            shuffled_pnl  = random.sample(pnl_sequence, n)
            shuffled_wins = random.sample(win_flags,    n)

            wr = sum(shuffled_wins) / n
            sim_win_rates.append(wr)

            equity = 1.0
            peak   = 1.0
            max_dd = 0.0
            for pnl in shuffled_pnl:
                equity *= (1 + pnl / 100)
                if equity > peak:
                    peak = equity
                dd = (peak - equity) / peak
                if dd > max_dd:
                    max_dd = dd
            sim_max_dds.append(max_dd)

            if max_dd >= self.ruin_threshold:
                ruin_count += 1

        sim_win_rates.sort()
        sim_max_dds.sort()

        mean_wr  = statistics.mean(sim_win_rates)
        p5_wr    = sim_win_rates[int(0.05 * self.n_simulations)]
        p95_wr   = sim_win_rates[int(0.95 * self.n_simulations)]
        mean_dd  = statistics.mean(sim_max_dds)
        worst_dd = sim_max_dds[-1]
        prob_ruin= ruin_count / self.n_simulations

        if prob_ruin < 0.05 and p5_wr >= 0.55:
            rec = "robust"
        elif prob_ruin < 0.20:
            rec = "marginal"
        else:
            rec = "fragile"

        result = MonteCarloResult(
            simulations      = self.n_simulations,
            mean_win_rate    = round(mean_wr,  4),
            win_rate_5th_pct = round(p5_wr,   4),
            win_rate_95th_pct= round(p95_wr,  4),
            mean_max_drawdown= round(mean_dd,  4),
            worst_max_drawdown= round(worst_dd, 4),
            prob_ruin        = round(prob_ruin, 4),
            recommendation   = rec,
        )

        logger.info(
            "Monte Carlo: mean_wr=%.1f%% p5=%.1f%% worst_dd=%.1f%% ruin=%.1f%% → %s",
            mean_wr * 100, p5_wr * 100, worst_dd * 100, prob_ruin * 100, rec
        )
        return result

    def print_report(self, result: MonteCarloResult) -> None:
        icon = {"robust": "✅", "marginal": "⚠️", "fragile": "❌"}[result.recommendation]
        print(f"\n{'='*55}")
        print(f"  MONTE CARLO  ({result.simulations:,} simulations)")
        print(f"{'='*55}")
        print(f"  Win rate  mean={result.mean_win_rate:.1%}  "
              f"5th={result.win_rate_5th_pct:.1%}  95th={result.win_rate_95th_pct:.1%}")
        print(f"  Max DD    mean={result.mean_max_drawdown:.1%}  "
              f"worst={result.worst_max_drawdown:.1%}")
        print(f"  Prob ruin : {result.prob_ruin:.1%}")
        print(f"  Verdict   : {icon} {result.recommendation.upper()}")
        print(f"{'='*55}\n")
