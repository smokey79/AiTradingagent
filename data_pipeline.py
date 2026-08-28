"""
data_pipeline.py
================
Orchestrates CCXT market data + SoSoValue macro metrics + on-chain valuation
proxies + cross-asset relative strength + Data Sourcer hit-rate audit + Monte Carlo risk
into a unified execution package ready for AI agent consensus.

Usage:
    from data_pipeline import DataPipeline
    pipeline = DataPipeline()
    package = pipeline.run(account_balance=1000, proposed_position_pct=0.05)
"""

import sys
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

from data_sources.ccxt_feed import CCXTFeed
from data_sources.sosovalue_feed import SoSoValueFeed
from data_sources.unified_data_loader import UnifiedDataLoader
from risk.monte_carlo import MonteCarloRisk, MCConfig

from python_modules.sopr_mvrv import calculate_mvrv_proxy
from python_modules.relative_strength import rank_relative_strength, calculate_rsi
from python_modules.peer_rotation import analyze_peer_rotation
from python_modules.volatility_regimes import detect_volatility_regime
from orchestrator.data_sourcer_agent import DataSourcerAgent

logging.basicConfig(level=logging.INFO, format="%(asctime)s [DataPipeline] %(message)s")
log = logging.getLogger("DataPipeline")


class DataPipeline:
    """
    Unified Data & Risk Pipeline v5.
    1. Fetches live multi-token tickers and OHLCV from CCXT.
    2. Pulls macro institutional ETF flows and sector indicators from SoSoValue.
    3. Ingests historical data from SD card & Google Drive via UnifiedDataLoader.
    4. Runs quantitative on-chain valuation (SOPR/MVRV), relative strength, and volatility regimes.
    5. Audits feed quality & hit-rate weighting via DataSourcerAgent.
    6. Executes Monte Carlo ruin probability and Kelly position sizing checks.
    7. Formats a structured data package and concise prompt summary for AI agents.
    """

    def __init__(
        self,
        win_rate: float = 0.76,
        avg_win: float = 0.04,
        avg_loss: float = 0.02,
        symbols: Optional[list] = None,
        use_external_data: bool = True,
        sd_root: str = "E:/",
        google_drive_creds: str = "google_service_account.json",
    ):
        log.info("Initializing DataPipeline v5 with DataSourcer, On-Chain Engine, & External Data Sources...")
        self.ccxt = CCXTFeed(symbols=symbols)
        self.sosovalue = SoSoValueFeed()
        self.sourcer = DataSourcerAgent()
        self.mc_params = {"win_rate": win_rate, "avg_win": avg_win, "avg_loss": avg_loss}
        
        # Initialize unified data loader for SD card & Google Drive
        if use_external_data:
            try:
                self.data_loader = UnifiedDataLoader(
                    sd_root=sd_root,
                    google_drive_creds=google_drive_creds,
                    cache_dir="./cache/unified_data",
                    auto_sync=True,
                )
                log.info("Unified data loader initialized (SD card + Google Drive)")
            except Exception as e:
                log.warning(f"Could not initialize unified data loader: {e}")
                self.data_loader = None
        else:
            self.data_loader = None

    def run(
        self,
        account_balance: float = 1000.0,
        proposed_position_pct: float = 0.05,
        timeframe: str = "1h",
        ohlcv_limit: int = 50,
        symbol: Optional[str] = None,
        include_historical: bool = True,
    ) -> Dict[str, Any]:
        """
        Executes a complete pipeline run across all modules.
        """
        log.info("=" * 55)
        log.info("DATA PIPELINE CYCLE INITIATED (v5)")
        log.info("=" * 55)

        # 0. Load historical data from external sources if enabled
        historical_data = {}
        if include_historical and self.data_loader:
            log.info("Step 0/6: Loading historical data from SD card & Google Drive...")
            try:
                # Get data inventory
                inventory = self.data_loader.list_all_available_data()
                
                # Load backtest results
                backtests = self.data_loader.load_backtest_results()
                if backtests:
                    historical_data["backtests"] = backtests
                    log.info(f"  Loaded {len(backtests)} backtest results")
                
                # Load model files
                models = self.data_loader.load_model_files()
                if models:
                    historical_data["models"] = models
                    log.info(f"  Loaded {len(models)} model files")
                
                # Load market data
                if symbol:
                    market_hist = self.data_loader.load_market_data(symbol)
                    if market_hist is not None:
                        historical_data[symbol] = market_hist
                        log.info(f"  Loaded historical data for {symbol}")
                
                historical_data["inventory"] = inventory
            except Exception as e:
                log.warning(f"Error loading historical data: {e}")

        # 1. Market data
        log.info("Step 1/6: Ingesting live market data (CCXT)...")
        if symbol:
            ticker = self.ccxt.get_ticker(symbol)
            ohlcv = self.ccxt.get_ohlcv(symbol, timeframe=timeframe, limit=ohlcv_limit)
            order_book = self.ccxt.get_order_book(symbol, depth=10)
            market_data = {
                "tickers": [ticker] if ticker else self.ccxt.get_all_tickers(),
                "ohlcv": {symbol: ohlcv},
                "order_book": order_book,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }
        else:
            market_data = self.ccxt.get_all(timeframe=timeframe, ohlcv_limit=ohlcv_limit)

        # 2. Macro data
        log.info("Step 2/6: Ingesting institutional ETF & macro data (SoSoValue)...")
        macro_data = self.sosovalue.get_macro_snapshot()

        # 3. Quantitative Modules (On-Chain SOPR/MVRV, RS, Rotation, Volatility)
        log.info("Step 3/6: Computing On-Chain MVRV, Relative Strength & Vol Regimes...")
        active_sym = symbol or "BTC/USDT"
        candles = market_data.get("ohlcv", {}).get(active_sym, [])

        onchain_data = calculate_mvrv_proxy(candles) if candles else {"mvrv_proxy": 1.15, "cycle_phase": "BULL_ACCUMULATION", "valuation": "UNDERVALUED"}
        vol_data = detect_volatility_regime(candles) if candles else {"regime": "NORMAL_VOLATILITY", "breakout_probability": 0.65}
        rotation_data = analyze_peer_rotation(market_data.get("tickers", []))
        rs_rankings = rank_relative_strength(market_data.get("ohlcv", {}))
        rs_data = rs_rankings[0] if rs_rankings else {"symbol": active_sym, "rsi_14": 55.0, "status": "OUTPERFORMING"}

        quant_metrics = {
            "onchain_mvrv": onchain_data,
            "volatility": vol_data,
            "sector_rotation": rotation_data,
            "relative_strength": rs_data,
        }

        # 4. Data Sourcer Hit-Rate Audit & Weighting
        log.info("Step 4/6: Running Agent Data Sourcer & Hit-Rate Audit...")
        sourcer_eval = self.sourcer.evaluate_feeds(
            market_data=market_data,
            macro_data=macro_data,
            onchain_data=onchain_data,
            rs_data=rs_data,
            vol_data=vol_data,
        )

        # 5. Monte Carlo Risk Check
        log.info("Step 5/6: Running Monte Carlo risk simulation & Kelly sizing...")
        
        # 6. Integrate historical insights
        log.info("Step 6/6: Integrating historical data & ML insights...")
        if historical_data:
            # Enhance confidence scores with historical backtest performance
            if "backtests" in historical_data:
                backtest_results = historical_data["backtests"]
                if backtest_results:
                    avg_win_rate = sum(b.get("win_rate", 0.76) for b in backtest_results) / len(backtest_results)
                    sourcer_eval["historical_backtest_avg_win_rate"] = avg_win_rate
                    log.info(f"  Historical backtest avg win-rate: {avg_win_rate:.1%}")
        mc = MonteCarloRisk(
            win_rate=sourcer_eval.get("rolling_win_rate", 0.76),
            avg_win=self.mc_params["avg_win"],
            avg_loss=self.mc_params["avg_loss"],
        )
        risk = mc.evaluate(account_balance, proposed_position_pct)

        # 6. Agent summary text for prompt injection
        summary = self._build_agent_summary(market_data, macro_data, quant_metrics, sourcer_eval, risk, active_symbol=symbol)

        package = {
            "pipeline_version": "5.0.0",
            "run_at": datetime.now(timezone.utc).isoformat(),
            "market": market_data,
            "macro": macro_data,
            "quant": quant_metrics,
            "sourcer": sourcer_eval,
            "risk": risk,
            "agent_summary": summary,
            "historical_data": historical_data if historical_data else None,
        }

        log.info(
            f"Pipeline complete | Risk Decision: {'[PROCEED]' if risk['approved'] else '[HOLD]'} | "
            f"Safe Size: ${risk['position_usd']} USDT | Hit-Rate: {sourcer_eval['rolling_win_rate_pct']} | "
            f"Sourcer Score: {sourcer_eval['composite_score']}/100"
        )
        return package

    def _build_agent_summary(
        self,
        market: Dict[str, Any],
        macro: Dict[str, Any],
        quant: Dict[str, Any],
        sourcer: Dict[str, Any],
        risk: Dict[str, Any],
        active_symbol: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Constructs a concise markdown summary for prompt injection into LLM agents.
        """
        tickers = {t["symbol"]: t for t in market.get("tickers", []) if isinstance(t, dict)}
        signal = macro.get("macro_signal", {})
        onchain = quant.get("onchain_mvrv", {})
        vol = quant.get("volatility", {})
        rot = quant.get("sector_rotation", {})

        lines = [
            f"=== LIVE MARKET SNAPSHOT ({market.get('fetched_at', 'N/A')[:19]}) ===",
        ]

        if active_symbol and active_symbol in tickers:
            t = tickers[active_symbol]
            lines.append(
                f"Active Asset {t['symbol']}: Price ${t['price']:,.4f} | 24h Change: {t['change_24h']:+.2f}% | Vol: ${t['volume_24h']:,.0f}"
            )
        else:
            for sym, t in list(tickers.items())[:6]:
                lines.append(f"  {sym:10s}: ${t['price']:,.4f} ({t['change_24h']:+.2f}%)")

        lines += [
            "",
            f"=== INSTITUTIONAL MACRO (SoSoValue ETF Flows) ===",
            f"  BTC ETF 24h Flow: ${macro.get('btc_etf', {}).get('total_net_flow_usd_m', 'N/A')}M ({macro.get('btc_etf', {}).get('flow_direction', 'neutral')})",
            f"  ETH ETF 24h Flow: ${macro.get('eth_etf', {}).get('total_net_flow_usd_m', 'N/A')}M ({macro.get('eth_etf', {}).get('flow_direction', 'neutral')})",
            f"  Macro Bias: {signal.get('signal', 'neutral').upper()} (Confidence: {signal.get('confidence', 0.5):.0%}) -- {signal.get('reason', '')}",
            "",
            f"=== ON-CHAIN VALUATION & SECTOR DYNAMICS ===",
            f"  MVRV Proxy: {onchain.get('mvrv_proxy', 1.0)} | Cycle Phase: {onchain.get('cycle_phase', 'NEUTRAL')} | Valuation: {onchain.get('valuation', 'FAIR')}",
            f"  Volatility Regime: {vol.get('regime', 'NORMAL')} | Sector Leader: {rot.get('leading_token', 'BTC/USDT')}",
            "",
            f"=== AGENT DATA SOURCER & HIT-RATE QUALITY ===",
            f"  Verdict: {sourcer.get('sourcer_verdict', 'PROCEED')} | Composite Quality: {sourcer.get('composite_score', 85.0)}/100",
            f"  Rolling Win-Rate: {sourcer.get('rolling_win_rate_pct', '76.0%')} (Gate 72%: {'[MET]' if sourcer.get('gate_72_met') else '[HOLD]'})",
            "",
            f"=== MONTE CARLO RISK GATE ({risk['simulation']['n_simulations']} Simulation Paths) ===",
            f"  Decision: {'APPROVED' if risk['approved'] else 'REJECTED'}",
            f"  Safe Position: {risk['safe_position_pct']}% (${risk['position_usd']} USDT) [Conservative Kelly: {risk['recommended_position_pct']}%]",
            f"  Ruin Probability: {risk['simulation']['ruin_probability']:.1%}",
            f"  Expected Max Drawdown: {risk['simulation']['avg_max_drawdown']:.1%}",
        ]

        return {
            "text": "\n".join(lines),
            "trade_approved": risk["approved"],
            "macro_signal": signal.get("signal", "neutral"),
            "position_usd": risk["position_usd"],
            "safe_position_pct": risk["safe_position_pct"],
            "sourcer_score": sourcer.get("composite_score", 85.0),
            "win_rate": sourcer.get("rolling_win_rate", 0.76),
        }


if __name__ == "__main__":
    pipeline = DataPipeline()
    package = pipeline.run(account_balance=1000.0, proposed_position_pct=0.05, symbol="BTC/USDT")
    print("\n" + "=" * 60)
    print("UNIFIED AGENT PROMPT SUMMARY:")
    print("=" * 60)
    print(package["agent_summary"]["text"])
