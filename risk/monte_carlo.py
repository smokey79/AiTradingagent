"""
monte_carlo.py
==============
Monte Carlo simulation for position sizing and risk validation.
Sits between signal generation and order execution.

Applies:
- Kelly Criterion (fractional Kelly for capital preservation)
- Probabilistic Ruin Simulation (1000+ paths)
- Max Drawdown Expectation and Equity Percentile Distribution (P10, P50, P90)
"""

import random
import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s [MonteCarlo] %(message)s")
log = logging.getLogger("MonteCarloRisk")


@dataclass
class MCConfig:
    n_simulations: int = 1000       # number of simulated equity paths
    n_trades: int = 200            # trades evaluated per path
    ruin_threshold: float = 0.20   # drawdown % that counts as ruin (e.g. 20%)
    max_ruin_prob: float = 0.10    # reject trade if ruin probability > 10%
    max_drawdown_pct: float = 0.15 # reject if expected max drawdown > 15%
    kelly_fraction: float = 0.25   # use 25% of full Kelly (conservative margin)


class MonteCarloRisk:
    """
    Monte Carlo Risk Validation and Kelly Position Sizing Engine.
    """

    def __init__(
        self,
        win_rate: float = 0.55,
        avg_win: float = 0.04,
        avg_loss: float = 0.02,
        config: Optional[MCConfig] = None,
    ):
        if not (0 < win_rate < 1):
            raise ValueError("win_rate must be between 0.0 and 1.0")
        if avg_win <= 0 or avg_loss <= 0:
            raise ValueError("avg_win and avg_loss must be positive numbers")

        self.win_rate = win_rate
        self.avg_win = avg_win
        self.avg_loss = avg_loss
        self.config = config or MCConfig()

        self._validate_edge()

    # ── Kelly Criterion ──────────────────────────────────────────────────────

    @property
    def full_kelly(self) -> float:
        """
        Full Kelly fraction: theoretical mathematical optimal bet size.
        Kelly = (win_rate * b - (1 - win_rate)) / b  where b = avg_win / avg_loss.
        """
        b = self.avg_win / self.avg_loss
        k = (self.win_rate * b - (1.0 - self.win_rate)) / b
        return max(0.0, k)

    @property
    def recommended_position_pct(self) -> float:
        """
        Conservative Kelly: uses a fraction (default 25%) of full Kelly.
        Safeguards against estimation error and market regime shifts.
        """
        return round(self.full_kelly * self.config.kelly_fraction, 4)

    @property
    def recommended_pct(self) -> float:
        """Alias for recommended_position_pct."""
        return self.recommended_position_pct

    # ── Simulation ───────────────────────────────────────────────────────────

    def simulate(self, position_pct: float) -> Dict[str, Any]:
        """
        Run N simulations of M trades at the specified position size.
        Returns statistics across all simulated equity paths.
        """
        cfg = self.config
        final_equities = []
        max_drawdowns = []
        ruin_count = 0
        random.seed(42)

        for _ in range(cfg.n_simulations):
            equity = 1.0
            peak = 1.0
            max_dd = 0.0
            ruined = False

            for _ in range(cfg.n_trades):
                if random.random() < self.win_rate:
                    equity *= (1.0 + position_pct * (self.avg_win / self.avg_loss))
                else:
                    equity *= (1.0 - position_pct)

                if equity > peak:
                    peak = equity
                drawdown = (peak - equity) / peak if peak > 0 else 0.0
                if drawdown > max_dd:
                    max_dd = drawdown

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
            "n_simulations": n,
            "n_trades": cfg.n_trades,
            "position_pct": round(position_pct * 100, 2),
            "ruin_probability": round(ruin_count / n, 4),
            "avg_max_drawdown": round(sum(max_drawdowns) / n, 4),
            "worst_drawdown": round(max(max_drawdowns), 4),
            "median_return": round(final_equities[n // 2] - 1.0, 4),
            "p10_return": round(final_equities[int(n * 0.10)] - 1.0, 4),
            "p90_return": round(final_equities[int(n * 0.90)] - 1.0, 4),
            "expected_return": round((sum(final_equities) / n) - 1.0, 4),
        }

    # ── Trade Evaluation & Risk Gate ─────────────────────────────────────────

    def evaluate(
        self, account_balance: float = 1000.0, proposed_position_pct: float = 0.05
    ) -> Dict[str, Any]:
        """
        Main risk evaluation gate: approves or vetoes trade parameters.
        """
        cfg = self.config
        stats = self.simulate(proposed_position_pct)
        kelly = self.recommended_position_pct
        issues = []

        if stats["ruin_probability"] > cfg.max_ruin_prob:
            issues.append(
                f"Ruin probability ({stats['ruin_probability']:.1%}) exceeds limit ({cfg.max_ruin_prob:.1%})"
            )
        if stats["avg_max_drawdown"] > cfg.max_drawdown_pct:
            issues.append(
                f"Expected drawdown ({stats['avg_max_drawdown']:.1%}) exceeds limit ({cfg.max_drawdown_pct:.1%})"
            )
        if proposed_position_pct > kelly * 2 and kelly > 0:
            issues.append(
                f"Position size ({proposed_position_pct:.1%}) exceeds 2x Kelly limit ({kelly * 2:.1%})"
            )

        approved = len(issues) == 0
        safe_position_pct = min(proposed_position_pct, kelly) if kelly > 0 else 0.01
        position_usd = round(account_balance * safe_position_pct, 2)

        result = {
            "approved": approved,
            "proposed_position_pct": round(proposed_position_pct * 100, 2),
            "recommended_position_pct": round(kelly * 100, 2),
            "safe_position_pct": round(safe_position_pct * 100, 2),
            "position_usd": position_usd,
            "account_balance": account_balance,
            "full_kelly_pct": round(self.full_kelly * 100, 2),
            "edge": {
                "win_rate": self.win_rate,
                "avg_win": self.avg_win,
                "avg_loss": self.avg_loss,
                "expectancy": round(
                    self.win_rate * self.avg_win - (1.0 - self.win_rate) * self.avg_loss, 4
                ),
            },
            "simulation": stats,
            "rejection_reasons": issues,
        }

        status = "✅ APPROVED" if approved else "❌ REJECTED"
        log.info(
            f"{status} | Position: {safe_position_pct:.1%} (${position_usd} USDT) | "
            f"Ruin prob: {stats['ruin_probability']:.1%} | Drawdown: {stats['avg_max_drawdown']:.1%}"
        )
        for issue in issues:
            log.warning(f"  ⚠ {issue}")

        return result

    def _validate_edge(self):
        """Validates statistical mathematical expectancy."""
        expectancy = self.win_rate * self.avg_win - (1.0 - self.win_rate) * self.avg_loss
        if expectancy <= 0:
            log.warning(
                f"⚠ Non-positive expectancy ({expectancy:.4f}) — strategy has no mathematical edge."
            )
        else:
            log.info(
                f"Edge confirmed: Expectancy = {expectancy:.4f} per trade | "
                f"Full Kelly = {self.full_kelly:.2%} | Conservative Kelly = {self.recommended_position_pct:.2%}"
            )


if __name__ == "__main__":
    mc = MonteCarloRisk(win_rate=0.55, avg_win=0.04, avg_loss=0.02)
    res = mc.evaluate(account_balance=1000.0, proposed_position_pct=0.10)
    print(f"\nDecision: {'APPROVED' if res['approved'] else 'REJECTED'}")
    print(f"Safe Size: {res['safe_position_pct']}% (${res['position_usd']})")
