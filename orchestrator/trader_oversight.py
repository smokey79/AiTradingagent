"""
orchestrator/trader_oversight.py
================================
Trader Oversight & Unit Economics Supervisor.
Tracks trade profitability %, exchange commissions, multi-chain gas costs,
LLM model token expenses, and lifetime project return on investment (ROI).
"""

import os
import sys
import json
import sqlite3
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional

if hasattr(sys.stdout, 'reconfigure'):
    try: sys.stdout.reconfigure(encoding='utf-8')
    except Exception: pass
if hasattr(sys.stderr, 'reconfigure'):
    try: sys.stderr.reconfigure(encoding='utf-8')
    except Exception: pass

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = PROJECT_ROOT / "data" / "trading.db"
MEMORY_PATH = PROJECT_ROOT / "src" / "strategy" / "strategy_memory.json"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [TraderOversight] %(message)s")
log = logging.getLogger("TraderOversight")

# Fee parameters
EXCHANGE_COMMISSION_RATE = 0.00075  # 0.075% Binance/Gate standard with fee discount

GAS_FEE_TABLE_USD = {
    "ethereum": 2.50,
    "arbitrum": 0.03,
    "base": 0.001,
    "bsc": 0.10,
    "polygon": 0.01,
    "cronos": 0.005,
    "cex": 0.00,
}

MODEL_PRICING_PER_1K_TOKENS = {
    "claude": {"prompt": 0.003, "completion": 0.015},
    "gpt4o": {"prompt": 0.0025, "completion": 0.010},
    "grok": {"prompt": 0.002, "completion": 0.010},
    "gemini": {"prompt": 0.000075, "completion": 0.0003},
    "deepseek": {"prompt": 0.00014, "completion": 0.00028},
    "local_free": {"prompt": 0.0000, "completion": 0.0000},
}


class TraderOversightAgent:
    """
    Supervises trade economics, costs, and project running profitability.
    """

    def __init__(self):
        self.default_chain = "arbitrum"

    def estimate_model_cycle_cost(
        self,
        agents_count: int = 6,
        avg_prompt_tokens: int = 850,
        avg_completion_tokens: int = 250,
        use_external_api: bool = False,
    ) -> float:
        """Estimates the dollar cost of LLM model inference for a single cycle."""
        if not use_external_api:
            # When using free / local quantitative fallbacks
            return 0.0002 * agents_count  # negligible compute proxy

        # Blended average across Claude, GPT-4o, Grok, Gemini, Qwen
        prompt_cost = (avg_prompt_tokens / 1000.0) * 0.0015
        completion_cost = (avg_completion_tokens / 1000.0) * 0.0060
        cost_per_agent = prompt_cost + completion_cost
        return round(cost_per_agent * agents_count, 5)

    def calculate_trade_economics(
        self,
        symbol: str = "BTC/USDT",
        position_usd: float = 50.0,
        expected_gain_pct: float = 0.04,  # default 4% take profit
        chain: str = "arbitrum",
        leverage: float = 5.0,
        use_external_api: bool = False,
    ) -> Dict[str, Any]:
        """
        Calculates complete cost breakdown, 5X leverage futures margin, liquidation distance, and net profitability.
        """
        chain_clean = chain.lower()
        gas_fee = GAS_FEE_TABLE_USD.get(chain_clean, 0.02)
        
        # 5X Futures margin exposure
        margin_collateral_usd = position_usd
        leveraged_exposure_usd = position_usd * leverage
        
        exchange_fee = round(leveraged_exposure_usd * EXCHANGE_COMMISSION_RATE * 2, 4)  # round trip taker fee on 5x notional
        model_cost = self.estimate_model_cycle_cost(use_external_api=use_external_api)
        slippage_est = round(leveraged_exposure_usd * 0.0004, 4)  # 0.04% slippage
        funding_fee_est = round(leveraged_exposure_usd * 0.0001, 4)  # 0.01% funding rate

        # Gross 5X profit on margin
        gross_profit_usd = round(leveraged_exposure_usd * expected_gain_pct, 4)
        total_costs_usd = round(exchange_fee + gas_fee + model_cost + slippage_est + funding_fee_est, 4)
        net_profit_usd = round(gross_profit_usd - total_costs_usd, 4)
        
        # Net ROI % on margin collateral
        net_profit_pct = round((net_profit_usd / max(margin_collateral_usd, 1.0)) * 100, 2)
        gross_roi_pct = round(expected_gain_pct * leverage * 100, 2)

        efficiency_pct = round((net_profit_usd / max(gross_profit_usd, 1e-6)) * 100, 2)
        cost_to_income_pct = round((total_costs_usd / max(gross_profit_usd, 1e-6)) * 100, 2)
        liquidation_buffer_pct = round((1.0 - (1.0 / leverage) + 0.025) * 100, 2)  # ~17.5% safety buffer for 5X

        # Verdict
        if net_profit_pct >= 5.0:
            verdict = "APPROVED_HIGH_MARGIN_5X"
            approved = True
        elif net_profit_pct >= 1.0:
            verdict = "APPROVED_5X_MARGINAL"
            approved = True
        else:
            verdict = "VETO_COST_EXCEEDS_ALPHA"
            approved = False

        return {
            "symbol": symbol,
            "position_usd": margin_collateral_usd,
            "leverage": f"{leverage}X",
            "leverage_multiplier": leverage,
            "leveraged_exposure_usd": leveraged_exposure_usd,
            "liquidation_safety_buffer_pct": liquidation_buffer_pct,
            "gross_expected_pnl_usd": gross_profit_usd,
            "gross_expected_pnl_pct": gross_roi_pct,
            "estimated_exchange_fee_usd": exchange_fee,
            "estimated_gas_fee_usd": gas_fee,
            "estimated_model_cycle_cost_usd": model_cost,
            "estimated_slippage_usd": slippage_est,
            "estimated_funding_fee_usd": funding_fee_est,
            "total_overhead_cost_usd": total_costs_usd,
            "net_expected_profit_usd": net_profit_usd,
            "net_profitability_pct": net_profit_pct,
            "cost_to_income_ratio_pct": cost_to_income_pct,
            "economic_efficiency_pct": max(0.0, efficiency_pct),
            "oversight_verdict": verdict,
            "approved": approved,
        }

    def get_project_lifetime_economics(self) -> Dict[str, Any]:
        """
        Calculates cumulative project running accounting: total trading gains vs. total fees & model costs.
        """
        total_trades = 0
        gross_profit = 0.0
        total_fees = 0.0
        total_gas = 0.0
        total_model_costs = 0.0

        if DB_PATH.exists():
            try:
                conn = sqlite3.connect(DB_PATH)
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                rows = cursor.execute("SELECT * FROM trades").fetchall()
                conn.close()

                for r in rows:
                    pnl = float(r["pnl_usdt"] or 0.0)
                    size = float(r["size_usdt"] or 50.0)
                    total_trades += 1
                    gross_profit += pnl
                    total_fees += size * EXCHANGE_COMMISSION_RATE * 2
                    total_gas += 0.02
                    total_model_costs += 0.0012
            except Exception as e:
                log.warning(f"Error reading lifetime trade stats: {e}")

        if total_trades == 0:
            total_trades = 0
            gross_profit = 0.0
            total_fees = 0.0
            total_gas = 0.0
            total_model_costs = 0.0

        total_costs = total_fees + total_gas + total_model_costs
        net_profit = gross_profit - total_costs
        cir = (total_costs / max(gross_profit, 1e-6)) * 100 if gross_profit > 0 else 0.0
        roi_pct = (net_profit / 250.0) * 100

        return {
            "total_trades_analyzed": total_trades,
            "gross_trading_profit_usd": round(gross_profit, 2),
            "total_exchange_fees_usd": round(total_fees, 2),
            "total_network_gas_usd": round(total_gas, 2),
            "total_llm_model_costs_usd": round(total_model_costs, 2),
            "total_operating_costs_usd": round(total_costs, 2),
            "net_realized_profit_usd": round(net_profit, 2),
            "cost_to_income_ratio_pct": round(cir, 2),
            "net_project_roi_pct": round(roi_pct, 2),
            "overall_economic_health": "EXCELLENT_PROFITABLE" if net_profit > 0 else "DEFICIT",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def build_prompt_injection(self, economics: Dict[str, Any]) -> str:
        """Constructs concise prompt section for Copilot Meta-Orchestrator."""
        lines = [
            "=== TRADER OVERSIGHT & UNIT ECONOMICS ===",
            f"  Verdict: {economics['oversight_verdict']} | Economic Approved: {'YES' if economics['approved'] else 'NO'}",
            f"  Position: ${economics['position_usd']} USDT | Gross Target: +${economics['gross_expected_pnl_usd']} ({economics['gross_expected_pnl_pct']}%)",
            f"  Overhead Breakdown: Exch Fee ${economics['estimated_exchange_fee_usd']} | Gas ${economics['estimated_gas_fee_usd']} | LLM Cost ${economics['estimated_model_cycle_cost_usd']}",
            f"  Net Projected Gain: +${economics['net_expected_profit_usd']} USDT ({economics['net_profitability_pct']}%) | Efficiency: {economics['economic_efficiency_pct']}%",
        ]
        return "\n".join(lines)


if __name__ == "__main__":
    oversight = TraderOversightAgent()
    trade_eco = oversight.calculate_trade_economics("BTC/USDT", position_usd=50.0, expected_gain_pct=0.04)
    lifetime = oversight.get_project_lifetime_economics()

    print("\n" + "=" * 65)
    print("TRADER OVERSIGHT TRADE UNIT ECONOMICS:")
    print("=" * 65)
    print(oversight.build_prompt_injection(trade_eco))

    print("\n" + "=" * 65)
    print("PROJECT LIFETIME RUNNING ECONOMICS:")
    print("=" * 65)
    for k, v in lifetime.items():
        print(f"  {k:30s}: {v}")
