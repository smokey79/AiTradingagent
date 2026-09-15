"""
data_pipeline.py
================
Orchestrates CCXT + SoSoValue + Monte Carlo into a single
data package ready for your AI agents.

File location: C:\\Users\\AlanJ\\projects\\AiTradingagent\\data_pipeline.py

Run:
    python data_pipeline.py

Or import into your orchestrator:
    from data_pipeline import DataPipeline
    pipeline = DataPipeline()
    package  = pipeline.run(account_balance=1000, proposed_position_pct=0.05)
"""

import json
import logging
from datetime import datetime, timezone

from data_sources.ccxt_feed      import CCXTFeed
from data_sources.sosovalue_feed import SoSoValueFeed
from risk.monte_carlo            import MonteCarloRisk, MCConfig

logging.basicConfig(level=logging.INFO, format="%(asctime)s [Pipeline] %(message)s")
log = logging.getLogger(__name__)


class DataPipeline:
    """
    Single entry point that:
    1. Pulls live market data (CCXT)
    2. Pulls macro data (SoSoValue)
    3. Runs Monte Carlo risk check
    4. Returns a structured package for AI agents
    """

    def __init__(
        self,
        win_rate: float = 0.55,
        avg_win:  float = 0.04,
        avg_loss: float = 0.02,
    ):
        log.info("Initialising DataPipeline...")
        self.ccxt       = CCXTFeed()
        self.sosovalue  = SoSoValueFeed()
        self.mc_params  = {"win_rate": win_rate, "avg_win": avg_win, "avg_loss": avg_loss}

    def run(
        self,
        account_balance:       float = 1000.0,
        proposed_position_pct: float = 0.05,
        timeframe:             str   = "1h",
        ohlcv_limit:           int   = 100,
    ) -> dict:
        """
        Full pipeline run. Returns agent-ready data package.

        Parameters
        ----------
        account_balance        : your total trading balance in USDT
        proposed_position_pct  : proposed trade size as % of balance (e.g. 0.05 = 5%)
        timeframe              : candle timeframe for OHLCV ('1h', '4h', '1d')
        ohlcv_limit            : number of candles to fetch
        """

        log.info("=" * 50)
        log.info("PIPELINE RUN STARTED")
        log.info("=" * 50)

        # 1. Market data
        log.info("Step 1/3: Fetching live market data (CCXT)...")
        market_data = self.ccxt.get_all(timeframe=timeframe, ohlcv_limit=ohlcv_limit)

        # 2. Macro data
        log.info("Step 2/3: Fetching macro data (SoSoValue)...")
        macro_data = self.sosovalue.get_macro_snapshot()

        # 3. Monte Carlo risk check
        log.info("Step 3/3: Running Monte Carlo risk evaluation...")
        mc    = MonteCarloRisk(**self.mc_params)
        risk  = mc.evaluate(account_balance, proposed_position_pct)

        # 4. Assemble agent package
        package = {
            "pipeline_version": "1.0.0",
            "run_at":           datetime.now(timezone.utc).isoformat(),
            "market":           market_data,
            "macro":            macro_data,
            "risk":             risk,
            "agent_summary":    self._build_agent_summary(market_data, macro_data, risk),
        }

        log.info("Pipeline complete.")
        log.info(
            f"Trade decision: {'✅ PROCEED' if risk['approved'] else '❌ HOLD'} | "
            f"Position: ${risk['position_usd']} USDT | "
            f"Macro: {macro_data['macro_signal']['signal'].upper()}"
        )
        return package

    def _build_agent_summary(self, market: dict, macro: dict, risk: dict) -> dict:
        """
        Concise text summary injected into AI agent prompts.
        Keep this short — it's prepended to every agent call.
        """
        tickers = {t["symbol"]: t for t in market.get("tickers", [])}
        signal  = macro.get("macro_signal", {})

        lines = [
            f"MARKET SNAPSHOT ({market.get('fetched_at', 'N/A')[:10]})",
        ]
        for sym, t in tickers.items():
            lines.append(
                f"  {sym}: ${t['price']:,.4f} | 24h: {t['change_24h']:+.2f}%"
            )

        lines += [
            "",
            f"MACRO (SoSoValue)",
            f"  BTC ETF flow: ${macro['btc_etf'].get('total_net_flow_usd_m', 'N/A')}M "
            f"({macro['btc_etf'].get('flow_direction', '')})",
            f"  ETH ETF flow: ${macro['eth_etf'].get('total_net_flow_usd_m', 'N/A')}M "
            f"({macro['eth_etf'].get('flow_direction', '')})",
            f"  Macro signal: {signal.get('signal', '?').upper()} "
            f"(confidence {signal.get('confidence', 0):.0%}) — {signal.get('reason', '')}",
            "",
            f"RISK (Monte Carlo | {risk['simulation']['n_simulations']} paths)",
            f"  Decision:       {'APPROVED' if risk['approved'] else 'REJECTED'}",
            f"  Position size:  {risk['safe_position_pct']}% = ${risk['position_usd']} USDT",
            f"  Ruin prob:      {risk['simulation']['ruin_probability']:.1%}",
            f"  Avg drawdown:   {risk['simulation']['avg_max_drawdown']:.1%}",
        ]

        return {
            "text":           "\n".join(lines),
            "trade_approved": risk["approved"],
            "macro_signal":   signal.get("signal", "neutral"),
            "position_usd":   risk["position_usd"],
        }


# ── Quick test ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    pipeline = DataPipeline(
        win_rate=0.55,
        avg_win=0.04,
        avg_loss=0.02,
    )

    package = pipeline.run(
        account_balance=1000.0,
        proposed_position_pct=0.05,   # 5% position size
        timeframe="1h",
        ohlcv_limit=50,
    )

    print("\n" + "=" * 60)
    print("AGENT SUMMARY")
    print("=" * 60)
    print(package["agent_summary"]["text"])

    # Save to JSON for inspection
    with open("pipeline_output.json", "w") as f:
        json.dump(package, f, indent=2, default=str)
    print("\n✅ Full output saved to pipeline_output.json")
