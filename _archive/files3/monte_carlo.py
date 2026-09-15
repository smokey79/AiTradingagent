"""
monte_carlo.py
==============
Monte Carlo simulation for position sizing and risk validation.
Sits between signal generation and order execution.

File location: C:\\Users\\AlanJ\\projects\\AiTradingagent\\risk\\monte_carlo.py

No extra installs needed — uses standard Python only.

Usage:
    from risk.monte_carlo import MonteCarloRisk
    mc = MonteCarloRisk(win_rate=0.55, avg_win=0.04, avg_loss=0.02)
    result = mc.evaluate(account_balance=1000, proposed_position_pct=0.10)
    print(result)
"""

import random
import math
import logging
from dataclasses import dataclass, field
from typing import Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s [MonteCarlo] %(message)s")
log = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────────────

@dataclass
class MCConfig:
    n_simulations:    int   = 1000    # number of simulation paths
    n_trades:         int   = 200     # trades per simulation path
    ruin_threshold:   float = 0.20    # drawdown % that counts as 'ruin' (20%)
    max_ruin_prob:    float = 0.10    # reject trade if ruin probability > 10%
    max_drawdown_pct: float = 0.15    # reject if expected max drawdown > 15%
    kelly_fraction:   float = 0.25    # use 25% of full Kelly (conservative)


# ── Core Class ──────────────────────────────────────────────────────────────

class MonteCarloRisk:
    """
    Runs Monte Carlo simulations to:
    1. Estimate probability of ruin at a given position size
    2. Calculate Kelly-optimal position size
    3. Approve or reject a proposed trade size

    Parameters
    ----------
    win_rate : float   e.g. 0.55 for 55% win rate
    avg_win  : float   average win as decimal  e.g. 0.04 = 4%
    avg_loss : float   average loss as decimal e.g. 0.02 = 2% (positive number)
    config   : MCConfig  optional custom settings
    """

    def __init__(
        self,
        win_rate: float,
        avg_win:  float,
        avg_loss: float,
        config:   MCConfig = None,
    ):
        if not (0 < win_rate < 1):
            raise ValueError("win_rate must be between 0 and 1")
        if avg_win <= 0 or avg_loss <= 0:
            raise ValueError("avg_win and avg_loss must be positive")

        self.win_rate = win_rate
        self.avg_win  = avg_win
        self.avg_loss = avg_loss
        self.config   = config or MCConfig()

        self._validate_edge()

    # ── Kelly Criterion ──────────────────────────────────────────────────────

    @property
    def full_kelly(self) -> float:
        """
        Full Kelly fraction — theoretical optimal bet size.
        Kelly = W/L - (1-W)/G
        W = win rate, L = avg loss, G = avg win (as ratio)
        """
        b = self.avg_win / self.avg_loss   # win/loss ratio
        k = (self.win_rate * b - (1 - self.win_rate)) / b
        return max(0.0, k)

    @property
    def recommended_position_pct(self) -> float:
        """
        Conservative Kelly: uses fraction of full Kelly (default 25%).
        This is safer for live trading and accounts for model uncertainty.
        """
        return round(self.full_kelly * self.config.kelly_fraction, 4)

    # ── Simulation ───────────────────────────────────────────────────────────

    def simulate(self, position_pct: float) -> dict:
        """
        Run N simulations of M trades at a given position size.

        Returns statistics across all simulation paths.
        """
        cfg = self.config
        final_equities  = []
        max_drawdowns   = []
        ruin_count      = 0
        random.seed(42)   # reproducible results

        for _ in range(cfg.n_simulations):
            equity     = 1.0          # start at 1.0 (normalised)
            peak       = 1.0
            max_dd     = 0.0
            ruined     = False

            for _ in range(cfg.n_trades):
                if random.random() < self.win_rate:
                    equity *= (1 + position_pct * self.avg_win / self.avg_loss)
                else:
                    equity *= (1 - position_pct)

                # Track peak and drawdown
                if equity > peak:
                    peak = equity
                drawdown = (peak - equity) / peak
                if drawdown > max_dd:
                    max_dd = drawdown

                # Check ruin
                if drawdown >= cfg.ruin_threshold and not ruined:
                    ruined = True
                    ruin_count += 1
                    break

            final_equities.append(equity)
            max_drawdowns.append(max_dd)

        n = cfg.n_simulations
        final_equities.sort()
        max_drawdowns.sort()

        return {
            "n_simulations":      n,
            "n_trades":           cfg.n_trades,
            "position_pct":       round(position_pct * 100, 2),
            "ruin_probability":   round(ruin_count / n, 4),
            "avg_max_drawdown":   round(sum(max_drawdowns) / n, 4),
            "worst_drawdown":     round(max(max_drawdowns), 4),
            "median_return":      round(final_equities[n // 2] - 1, 4),
            "p10_return":         round(final_equities[int(n * 0.10)] - 1, 4),  # 10th percentile
            "p90_return":         round(final_equities[int(n * 0.90)] - 1, 4),  # 90th percentile
            "expected_return":    round(sum(final_equities) / n - 1, 4),
        }

    # ── Trade Evaluation ─────────────────────────────────────────────────────

    def evaluate(
        self,
        account_balance:       float,
        proposed_position_pct: float,
    ) -> dict:
        """
        Main method: approve or reject a trade.

        Parameters
        ----------
        account_balance       : float  e.g. 1000.0 (in USDT)
        proposed_position_pct : float  e.g. 0.10 for 10% of balance

        Returns
        -------
        dict with 'approved', 'recommended_position_pct', 'position_usd', and stats
        """
        cfg    = self.config
        stats  = self.simulate(proposed_position_pct)
        kelly  = self.recommended_position_pct
        issues = []

        # Rejection checks
        if stats["ruin_probability"] > cfg.max_ruin_prob:
            issues.append(
                f"Ruin probability {stats['ruin_probability']:.1%} "
                f"exceeds limit {cfg.max_ruin_prob:.1%}"
            )
        if stats["avg_max_drawdown"] > cfg.max_drawdown_pct:
            issues.append(
                f"Expected drawdown {stats['avg_max_drawdown']:.1%} "
                f"exceeds limit {cfg.max_drawdown_pct:.1%}"
            )
        if proposed_position_pct > kelly * 2:
            issues.append(
                f"Position size {proposed_position_pct:.1%} is more than "
                f"2× Kelly ({kelly:.1%}) — oversizing risk"
            )

        approved          = len(issues) == 0
        safe_position_pct = min(proposed_position_pct, kelly)
        position_usd      = round(account_balance * safe_position_pct, 2)

        result = {
            "approved":                approved,
            "proposed_position_pct":   round(proposed_position_pct * 100, 2),
            "recommended_position_pct": round(kelly * 100, 2),
            "safe_position_pct":       round(safe_position_pct * 100, 2),
            "position_usd":            position_usd,
            "account_balance":         account_balance,
            "full_kelly_pct":          round(self.full_kelly * 100, 2),
            "edge": {
                "win_rate":  self.win_rate,
                "avg_win":   self.avg_win,
                "avg_loss":  self.avg_loss,
                "expectancy": round(
                    self.win_rate * self.avg_win - (1 - self.win_rate) * self.avg_loss, 4
                ),
            },
            "simulation": stats,
            "rejection_reasons": issues,
        }

        status = "✅ APPROVED" if approved else "❌ REJECTED"
        log.info(
            f"{status} | Position: {safe_position_pct:.1%} (${position_usd}) | "
            f"Ruin prob: {stats['ruin_probability']:.1%} | "
            f"Avg drawdown: {stats['avg_max_drawdown']:.1%}"
        )
        if issues:
            for issue in issues:
                log.warning(f"  ⚠ {issue}")

        return result

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _validate_edge(self):
        """Warn if the strategy has no mathematical edge."""
        expectancy = self.win_rate * self.avg_win - (1 - self.win_rate) * self.avg_loss
        if expectancy <= 0:
            log.warning(
                f"⚠ Negative expectancy ({expectancy:.4f}) — "
                f"strategy has no edge at these parameters. Do not trade live."
            )
        else:
            log.info(
                f"Edge confirmed. Expectancy: {expectancy:.4f} per trade | "
                f"Full Kelly: {self.full_kelly:.2%} | "
                f"Recommended: {self.recommended_position_pct:.2%}"
            )


# ── Quick test ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Example: strategy with 55% win rate, 4% avg win, 2% avg loss
    mc = MonteCarloRisk(
        win_rate=0.55,
        avg_win=0.04,
        avg_loss=0.02,
    )

    result = mc.evaluate(
        account_balance=1000.0,
        proposed_position_pct=0.10,   # proposing 10% of account per trade
    )

    print("\n=== MONTE CARLO RISK EVALUATION ===")
    print(f"Decision:          {'✅ APPROVED' if result['approved'] else '❌ REJECTED'}")
    print(f"Proposed size:     {result['proposed_position_pct']}%")
    print(f"Recommended size:  {result['recommended_position_pct']}% (Kelly)")
    print(f"Position in USDT:  ${result['position_usd']}")
    print(f"Ruin probability:  {result['simulation']['ruin_probability']:.1%}")
    print(f"Avg max drawdown:  {result['simulation']['avg_max_drawdown']:.1%}")
    print(f"Median return:     {result['simulation']['median_return']:.1%}")
    print(f"Expectancy/trade:  {result['edge']['expectancy']:.4f}")
    if result["rejection_reasons"]:
        print("\nRejection reasons:")
        for r in result["rejection_reasons"]:
            print(f"  ⚠ {r}")
