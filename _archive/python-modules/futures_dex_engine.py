"""
python_modules/futures_dex_engine.py
====================================
DEX & 5X Leverage Perpetual Futures Trading Engine.
Calculates isolated 5X leverage margin requirements, liquidation buffers,
funding rate drag, take-profit multipliers, and L2 DEX execution routing.
"""

import os
import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional

logging.basicConfig(level=logging.INFO, format="%(asctime)s [FuturesDEX] %(message)s")
log = logging.getLogger("FuturesDEXEngine")

DEFAULT_LEVERAGE = 5.0
MAINTENANCE_MARGIN_RATE = 0.025  # 2.5% maintenance margin
DEFAULT_TAKER_FEE_RATE = 0.0005   # 0.05% futures taker fee
ESTIMATED_FUNDING_8H_PCT = 0.01   # 0.01% per 8h funding rate benchmark


class FuturesDEXEngine:
    """
    Manages 5X Leverage Futures contracts & DEX spot executions with strict margin supervision.
    """

    def __init__(self, leverage: float = 5.0):
        self.leverage = leverage

    def calculate_futures_position(
        self,
        symbol: str = "BTC/USDT",
        entry_price: float = 77700.0,
        side: str = "LONG",
        margin_usd: float = 100.0,
        take_profit_pct: float = 0.04,  # 4% underlying price move
        stop_loss_pct: float = 0.015,   # 1.5% underlying price move
    ) -> Dict[str, Any]:
        """
        Calculates 5X leveraged trade parameters, liquidation distance, and ROI.
        """
        side_clean = side.upper()
        leveraged_notional_usd = margin_usd * self.leverage
        contracts_qty = leveraged_notional_usd / entry_price if entry_price > 0 else 0.0

        # Liquidation calculation (isolated margin)
        # Long liquidation: Entry * (1 - (1/Leverage) + MaintenanceMargin)
        # Short liquidation: Entry * (1 + (1/Leverage) - MaintenanceMargin)
        margin_fraction = 1.0 / self.leverage  # 0.20 for 5X
        if side_clean in ("LONG", "BUY"):
            liquidation_price = entry_price * (1.0 - margin_fraction + MAINTENANCE_MARGIN_RATE)
            tp_price = entry_price * (1.0 + take_profit_pct)
            sl_price = entry_price * (1.0 - stop_loss_pct)
            liquidation_buffer_pct = ((entry_price - liquidation_price) / entry_price) * 100.0
        else:
            liquidation_price = entry_price * (1.0 + margin_fraction - MAINTENANCE_MARGIN_RATE)
            tp_price = entry_price * (1.0 - take_profit_pct)
            sl_price = entry_price * (1.0 + stop_loss_pct)
            liquidation_buffer_pct = ((liquidation_price - entry_price) / entry_price) * 100.0

        # PnL calculations with 5X multiplier
        gross_tp_roi_pct = take_profit_pct * self.leverage * 100.0  # +20% on margin
        gross_tp_pnl_usd = (gross_tp_roi_pct / 100.0) * margin_usd

        gross_sl_roi_pct = -stop_loss_pct * self.leverage * 100.0  # -7.5% on margin
        gross_sl_loss_usd = (gross_sl_roi_pct / 100.0) * margin_usd

        # Fee friction (Opening + Closing taker fee on leveraged notional)
        trading_fees_usd = (leveraged_notional_usd * DEFAULT_TAKER_FEE_RATE * 2)
        funding_fee_est_usd = (leveraged_notional_usd * (ESTIMATED_FUNDING_8H_PCT / 100.0))
        total_costs_usd = trading_fees_usd + funding_fee_est_usd

        net_tp_pnl_usd = gross_tp_pnl_usd - total_costs_usd
        net_tp_roi_pct = (net_tp_pnl_usd / margin_usd) * 100.0

        return {
            "symbol": symbol,
            "side": side_clean,
            "leverage": f"{self.leverage}X",
            "leverage_value": self.leverage,
            "margin_collateral_usd": margin_usd,
            "leveraged_exposure_usd": leveraged_notional_usd,
            "contract_units": round(contracts_qty, 6),
            "entry_price": entry_price,
            "take_profit_price": round(tp_price, 2),
            "stop_loss_price": round(sl_price, 2),
            "liquidation_price": round(liquidation_price, 2),
            "liquidation_safety_buffer_pct": round(liquidation_buffer_pct, 2),
            "liquidation_safe": liquidation_buffer_pct >= 15.0,
            "gross_target_roi_pct": round(gross_tp_roi_pct, 2),
            "net_target_pnl_usd": round(net_tp_pnl_usd, 2),
            "net_target_roi_pct": round(net_tp_roi_pct, 2),
            "max_risk_loss_usd": round(abs(gross_sl_loss_usd) + total_costs_usd, 2),
            "max_risk_pct": round(abs(gross_sl_roi_pct) + ((total_costs_usd / margin_usd) * 100), 2),
            "estimated_fees_usd": round(total_costs_usd, 3),
            "risk_reward_ratio": round(net_tp_pnl_usd / (abs(gross_sl_loss_usd) + total_costs_usd), 2) if (abs(gross_sl_loss_usd) + total_costs_usd) > 0 else 2.5,
            "status": "APPROVED_5X_LEVERAGE" if liquidation_buffer_pct >= 15.0 else "REJECTED_HIGH_RISK",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def evaluate_dex_swap(
        self,
        chain: str = "arbitrum",
        dex: str = "Uniswap v3",
        token_in: str = "USDT",
        token_out: str = "ETH",
        amount_in_usd: float = 100.0,
        price: float = 3520.0,
        gas_usd: float = 0.03,
    ) -> Dict[str, Any]:
        """
        Evaluates spot DEX swap execution on low-cost L2s.
        """
        swap_fee_pct = 0.05  # 0.05% Uniswap v3 fee tier
        swap_fee_usd = amount_in_usd * (swap_fee_pct / 100.0)
        slippage_est_usd = amount_in_usd * 0.0005  # 0.05%
        total_costs_usd = gas_usd + swap_fee_usd + slippage_est_usd
        tokens_received = (amount_in_usd - total_costs_usd) / price if price > 0 else 0.0

        return {
            "type": "DEX_SPOT_SWAP",
            "chain": chain,
            "dex": dex,
            "pair": f"{token_out}/{token_in}",
            "amount_in_usd": amount_in_usd,
            "estimated_price": price,
            "tokens_received": round(tokens_received, 6),
            "gas_cost_usd": gas_usd,
            "swap_fee_usd": round(swap_fee_usd, 3),
            "slippage_usd": round(slippage_est_usd, 3),
            "total_friction_usd": round(total_costs_usd, 3),
            "execution_efficiency_pct": round(((amount_in_usd - total_costs_usd) / amount_in_usd) * 100.0, 2),
        }


if __name__ == "__main__":
    engine = FuturesDEXEngine(leverage=5.0)
    pos = engine.calculate_futures_position(symbol="BTC/USDT", entry_price=77700.0, side="LONG", margin_usd=100.0)
    print("=== 5X FUTURES POSITION MODEL ===")
    print(json.dumps(pos, indent=2))
