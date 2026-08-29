"""
integrated_data_pipeline.py
===========================
Unified data pipeline integrating:
- CCXT (multiple exchanges including Bitget)
- CoinGecko (market data & trends)
- Telegram (notifications)
- SD Card + Google Drive (historical data)
"""

import sys
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional
import asyncio

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

from data_sources.ccxt_feed import CCXTFeed
from data_sources.coingecko_feed import CoinGeckoFeed
from data_sources.coinmarketcap_feed import CoinMarketCapFeed
from data_sources.bitget_exchange import BitgetExchange
from data_sources.telegram_notifier import TelegramNotifier
from data_sources.sosovalue_feed import SoSoValueFeed
from data_sources.unified_data_loader import UnifiedDataLoader
from risk.monte_carlo import MonteCarloRisk, MCConfig
from python_modules.sopr_mvrv import calculate_mvrv_proxy
from python_modules.relative_strength import rank_relative_strength, calculate_rsi
from python_modules.peer_rotation import analyze_peer_rotation
from python_modules.volatility_regimes import detect_volatility_regime
from orchestrator.data_sourcer_agent import DataSourcerAgent

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
log = logging.getLogger("IntegratedPipeline")


class IntegratedDataPipeline:
    """
    Unified data pipeline v6 with CoinMarketCap, Telegram, CoinGecko, Bitget, and external data sources.
    """

    def __init__(
        self,
        win_rate: float = 0.76,
        avg_win: float = 0.04,
        avg_loss: float = 0.02,
        symbols: Optional[list] = None,
        use_external_data: bool = True,
        use_telegram: bool = True,
        use_coingecko: bool = True,
        use_coinmarketcap: bool = True,
        use_bitget: bool = True,
    ):
        """
        Initialize integrated pipeline with all data sources.

        Args:
            win_rate: Historical win rate for MC simulation
            avg_win: Average win percentage
            avg_loss: Average loss percentage
            symbols: Trading pairs
            use_external_data: Enable SD card + Google Drive loader
            use_telegram: Enable Telegram notifications
            use_coingecko: Enable CoinGecko data feed
            use_coinmarketcap: Enable CoinMarketCap data feed
            use_bitget: Enable Bitget exchange integration
        """
        log.info("Initializing Integrated Data Pipeline v6 with All Sources (including CoinMarketCap)...")

        # Core data sources
        self.ccxt = CCXTFeed(symbols=symbols)
        self.sosovalue = SoSoValueFeed()
        self.sourcer = DataSourcerAgent()
        self.mc_params = {"win_rate": win_rate, "avg_win": avg_win, "avg_loss": avg_loss}

        # Telegram notifications
        self.telegram = None
        if use_telegram:
            try:
                self.telegram = TelegramNotifier()
                if self.telegram.enabled:
                    log.info("✅ Telegram notifications enabled")
                else:
                    log.warning("⚠️  Telegram credentials missing")
            except Exception as e:
                log.warning(f"Telegram initialization error: {e}")

        # CoinGecko feed
        self.coingecko = None
        if use_coingecko:
            try:
                self.coingecko = CoinGeckoFeed()
                log.info("✅ CoinGecko data feed enabled")
            except Exception as e:
                log.warning(f"CoinGecko initialization error: {e}")

        # CoinMarketCap feed
        self.coinmarketcap = None
        if use_coinmarketcap:
            try:
                self.coinmarketcap = CoinMarketCapFeed()
                if self.coinmarketcap.is_configured:
                    log.info("✅ CoinMarketCap data feed enabled (API key configured)")
                else:
                    log.info("ℹ️  CoinMarketCap feed initialized (set CMC_API_KEY for live data)")
            except Exception as e:
                log.warning(f"CoinMarketCap initialization error: {e}")

        # Bitget exchange
        self.bitget = None
        if use_bitget:
            try:
                self.bitget = BitgetExchange(sandbox=True)  # Use sandbox by default
                if self.bitget.is_connected():
                    log.info("✅ Bitget exchange connected")
                else:
                    log.warning("⚠️  Bitget API credentials missing")
            except Exception as e:
                log.warning(f"Bitget initialization error: {e}")

        # Unified data loader
        self.data_loader = None
        if use_external_data:
            try:
                self.data_loader = UnifiedDataLoader(
                    sd_root="E:/",
                    google_drive_creds="google_service_account.json",
                    cache_dir="./cache/unified_data",
                    auto_sync=False,
                )
                log.info("✅ Unified data loader initialized")
            except Exception as e:
                log.warning(f"Data loader initialization error: {e}")

        log.info("Pipeline initialization complete!")

    async def run(
        self,
        account_balance: float = 1000.0,
        proposed_position_pct: float = 0.05,
        timeframe: str = "1h",
        ohlcv_limit: int = 50,
        symbol: Optional[str] = None,
        include_coingecko: bool = True,
        include_coinmarketcap: bool = True,
        include_bitget: bool = True,
        include_historical: bool = True,
        send_notifications: bool = True,
    ) -> Dict[str, Any]:
        """
        Execute complete integrated pipeline cycle.

        Returns:
            Comprehensive data package with all sources
        """
        log.info("=" * 70)
        log.info("INTEGRATED DATA PIPELINE CYCLE v6")
        log.info("=" * 70)

        package = {
            "pipeline_version": "6.0.0",
            "run_at": datetime.now(timezone.utc).isoformat(),
            "sources": {},
            "notifications_sent": [],
        }

        # ========== 1. CCXT Market Data ==========
        log.info("Step 1/7: Fetching CCXT market data...")
        if symbol:
            ticker = self.ccxt.get_ticker(symbol)
            ohlcv = self.ccxt.get_ohlcv(symbol, timeframe=timeframe, limit=ohlcv_limit)
            market_data = {
                "tickers": [ticker] if ticker else self.ccxt.get_all_tickers(),
                "ohlcv": {symbol: ohlcv},
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }
        else:
            market_data = self.ccxt.get_all(timeframe=timeframe, ohlcv_limit=ohlcv_limit)

        package["sources"]["ccxt"] = market_data

        # ========== 2. CoinGecko Market Data ==========
        if include_coingecko and self.coingecko:
            log.info("Step 2/8: Fetching CoinGecko data...")
            try:
                coingecko_data = {
                    "trending": self.coingecko.get_trending(5),
                    "global": self.coingecko.get_global_data(),
                    "defi": self.coingecko.get_defi_data(),
                }

                # Get specific token data if symbol provided
                if symbol:
                    token_id = symbol.lower().split("/")[0]
                    coingecko_data["token"] = self.coingecko.get_market_data(token_id)

                package["sources"]["coingecko"] = coingecko_data
                log.info("✅ CoinGecko data retrieved")
            except Exception as e:
                log.warning(f"CoinGecko data fetch error: {e}")

        # ========== 3. CoinMarketCap Market Data ==========
        if include_coinmarketcap and self.coinmarketcap and self.coinmarketcap.is_configured:
            log.info("Step 3/8: Fetching CoinMarketCap data...")
            try:
                universe_symbols = ["BTC", "ETH", "CRO", "SOL", "AVAX", "ARB", "OP"]
                if symbol:
                    active_coin = symbol.split("/")[0].upper()
                    if active_coin not in universe_symbols:
                        universe_symbols.append(active_coin)

                cmc_data = {
                    "quotes": self.coinmarketcap.get_quotes(symbols=universe_symbols),
                    "global": self.coinmarketcap.get_global_metrics(),
                    "gainers_losers": self.coinmarketcap.get_trending_gainers_losers(5),
                }

                if symbol:
                    cmc_data["active_quote"] = self.coinmarketcap.get_price(symbol)

                package["sources"]["coinmarketcap"] = cmc_data
                log.info("✅ CoinMarketCap data retrieved")
            except Exception as e:
                log.warning(f"CoinMarketCap data fetch error: {e}")

        # ========== 4. Bitget Exchange Data ==========
        if include_bitget and self.bitget and self.bitget.is_connected():
            log.info("Step 4/8: Fetching Bitget exchange data...")
            try:
                bitget_data = {
                    "balance": self.bitget.get_balance(),
                    "total_balance_usd": self.bitget.get_total_balance_usd(),
                    "open_orders": self.bitget.get_open_orders(),
                    "positions": self.bitget.get_positions() if self.bitget.trading_mode == "futures" else None,
                }

                package["sources"]["bitget"] = bitget_data
                log.info("✅ Bitget data retrieved")

                # Send portfolio notification
                if send_notifications and self.telegram and self.telegram.enabled:
                    try:
                        balance = bitget_data.get("total_balance_usd", 0)
                        await self.telegram.send_portfolio_update(
                            balance=balance,
                            pnl=0,
                            pnl_pct=0,
                            positions=bitget_data.get("open_orders", [])[:5],
                        )
                        package["notifications_sent"].append("portfolio_update")
                    except Exception as e:
                        log.warning(f"Portfolio notification error: {e}")
            except Exception as e:
                log.warning(f"Bitget data fetch error: {e}")

        # ========== 5. Macro Data (SoSoValue) ==========
        log.info("Step 5/8: Fetching macro data...")
        macro_data = self.sosovalue.get_macro_snapshot()
        package["sources"]["macro"] = macro_data

        # ========== 6. On-Chain & Technical Analysis ==========
        log.info("Step 6/8: Computing on-chain metrics...")
        active_sym = symbol or "BTC/USDT"
        candles = market_data.get("ohlcv", {}).get(active_sym, [])

        onchain_data = calculate_mvrv_proxy(candles) if candles else {"mvrv_proxy": 1.15}
        vol_data = detect_volatility_regime(candles) if candles else {"regime": "NORMAL_VOLATILITY"}
        rotation_data = analyze_peer_rotation(market_data.get("tickers", []))
        rs_rankings = rank_relative_strength(market_data.get("ohlcv", {}))

        quant_metrics = {
            "onchain_mvrv": onchain_data,
            "volatility": vol_data,
            "sector_rotation": rotation_data,
            "relative_strength": rs_rankings[0] if rs_rankings else {},
        }
        package["sources"]["quant"] = quant_metrics

        # ========== 7. Data Sourcer & Risk ==========
        log.info("Step 7/8: Running Data Sourcer audit...")
        sourcer_eval = self.sourcer.evaluate_feeds(
            market_data=market_data,
            macro_data=macro_data,
            onchain_data=onchain_data,
            rs_data=rs_rankings[0] if rs_rankings else {},
            vol_data=vol_data,
            coinmarketcap_data=package["sources"].get("coinmarketcap"),
        )

        mc = MonteCarloRisk(
            win_rate=sourcer_eval.get("rolling_win_rate", 0.76),
            avg_win=self.mc_params["avg_win"],
            avg_loss=self.mc_params["avg_loss"],
        )
        risk = mc.evaluate(account_balance, proposed_position_pct)

        package["sources"]["risk"] = risk
        package["sources"]["sourcer"] = sourcer_eval

        # ========== 8. Historical Data ==========
        if include_historical and self.data_loader:
            log.info("Step 8/8: Loading historical data...")
            try:
                historical_data = {
                    "backtests": self.data_loader.load_backtest_results(),
                    "models": self.data_loader.load_model_files(),
                    "inventory": self.data_loader.list_all_available_data(),
                }
                package["sources"]["historical"] = historical_data
            except Exception as e:
                log.warning(f"Historical data load error: {e}")

        # ========== Generate Summary & Send Notifications ==========
        log.info("Generating summary...")
        summary = self._build_summary(package, symbol)
        package["summary"] = summary

        if send_notifications and self.telegram and self.telegram.enabled and risk.get("approved"):
            try:
                await self.telegram.send_trade_signal(
                    symbol=symbol or "BTC/USDT",
                    action="BUY" if risk["approved"] else "HOLD",
                    confidence=sourcer_eval.get("composite_score", 0) / 100,
                    price=market_data.get("tickers", [{}])[0].get("price", 0),
                    reason=summary.get("decision_reason"),
                    metadata={"win_rate": sourcer_eval.get("rolling_win_rate_pct")},
                )
                package["notifications_sent"].append("trade_signal")
            except Exception as e:
                log.warning(f"Trade signal notification error: {e}")

        log.info("=" * 70)
        log.info(f"Pipeline complete | Data Sources: {len(package['sources'])} | "
                 f"Notifications: {len(package['notifications_sent'])}")
        log.info("=" * 70)

        return package

    def _build_summary(self, package: Dict[str, Any], symbol: Optional[str]) -> Dict[str, Any]:
        """Build executive summary from all data sources."""
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "symbol": symbol or "PORTFOLIO",
            "data_sources_available": list(package.get("sources", {}).keys()),
            "decision_reason": "Multi-source consensus generated",
            "alert_count": len(package.get("notifications_sent", [])),
        }


async def main():
    """Example usage of integrated pipeline."""
    pipeline = IntegratedDataPipeline(
        use_telegram=True,
        use_coingecko=True,
        use_coinmarketcap=True,
        use_bitget=True,
    )

    package = await pipeline.run(
        account_balance=1000,
        symbol="BTC/USDT",
        send_notifications=True,
    )

    print("\n" + "=" * 70)
    print("INTEGRATED PIPELINE RESULTS")
    print("=" * 70)
    print(f"Version: {package['pipeline_version']}")
    print(f"Run Time: {package['run_at']}")
    print(f"Data Sources: {', '.join(package['sources'].keys())}")
    print(f"Notifications Sent: {package['notifications_sent']}")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())

