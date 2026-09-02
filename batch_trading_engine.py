"""
batch_trading_engine.py
=======================
Complete trading engine using Claude Batch API for signal generation.
Analyzes multiple symbols and strategies efficiently.
"""

import asyncio
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime
import json

from claude_batch_processor import ClaudeBatchProcessor, TradingBatchAnalyzer
from data_sources.coingecko_feed import CoinGeckoFeed
from trading_mode_controller import TradingModeController

log = logging.getLogger("BatchTradingEngine")


class BatchTradingEngine:
    """
    Trading engine using Claude Batch API for efficient multi-symbol analysis.
    """

    def __init__(
        self,
        mode: str = "manual",
        paper_trading: bool = True,
    ):
        """
        Initialize batch trading engine.

        Args:
            mode: Trading mode (automation/manual/hybrid)
            paper_trading: Use paper trading
        """
        self.processor = ClaudeBatchProcessor()
        self.analyzer = TradingBatchAnalyzer()
        self.controller = TradingModeController(mode=mode, paper_trading=paper_trading)
        self.coingecko = CoinGeckoFeed()
        self.pending_batches = {}  # batch_id -> metadata

        log.info("Batch Trading Engine initialized")

    def prepare_symbol_batch(
        self,
        symbols: List[str],
    ) -> Dict[str, Any]:
        """
        Prepare market data for multiple symbols for batch analysis.

        Args:
            symbols: List of symbols to analyze (e.g., ["BTC/USDT", "ETH/USDT"])

        Returns:
            Batch preparation result
        """
        log.info(f"Preparing batch analysis for {len(symbols)} symbols")

        symbols_data = {}

        for symbol in symbols:
            try:
                token = symbol.split("/")[0].lower()

                # Get price data
                price_data = self.coingecko.get_price(token)

                # Get market data
                market_data = self.coingecko.get_market_data(token)

                if price_data and market_data:
                    symbols_data[symbol] = {
                        "price": price_data.get(token, {}).get("usd", 0),
                        "price_change_24h": price_data.get(token, {}).get(
                            "usd_24h_change", 0
                        ),
                        "market_cap": market_data.get("market_data", {}).get(
                            "market_cap", {}
                        ).get("usd", 0),
                        "volume_24h": market_data.get("market_data", {}).get(
                            "total_volume", {}
                        ).get("usd", 0),
                        "ath": market_data.get("market_data", {}).get("ath", {}).get(
                            "usd", 0
                        ),
                        "atl": market_data.get("market_data", {}).get("atl", {}).get(
                            "usd", 0
                        ),
                    }
            except Exception as e:
                log.warning(f"Error fetching data for {symbol}: {e}")

        # Submit batch
        result = self.analyzer.analyze_multiple_symbols(symbols_data)

        if result["status"] == "submitted":
            self.pending_batches[result["batch_id"]] = {
                "symbols": symbols,
                "submitted_at": datetime.utcnow().isoformat(),
                "status": "processing",
            }

        return result

    def get_batch_results(self, batch_id: str) -> Dict[str, Any]:
        """
        Get results from a completed batch analysis.

        Args:
            batch_id: Batch ID to retrieve

        Returns:
            Analysis results
        """
        log.info(f"Retrieving batch results | ID: {batch_id}")

        results = self.processor.retrieve_batch_results(batch_id)

        if results["status"] != "error" and batch_id in self.pending_batches:
            self.pending_batches[batch_id]["status"] = "completed"
            self.pending_batches[batch_id]["completed_at"] = datetime.utcnow().isoformat()

        return results

    def parse_signal(self, analysis_text: str) -> Dict[str, Any]:
        """
        Parse Claude's analysis into a trading signal.

        Args:
            analysis_text: Claude's analysis response

        Returns:
            Parsed signal
        """
        # Simple parsing - in production, would be more sophisticated
        signal = {
            "sentiment": "NEUTRAL",
            "action": "HOLD",
            "confidence": 0.5,
            "reasoning": analysis_text[:500],  # First 500 chars as summary
        }

        text_upper = analysis_text.upper()

        # Detect sentiment
        if "BULLISH" in text_upper:
            signal["sentiment"] = "BULLISH"
            signal["confidence"] = 0.75
        elif "BEARISH" in text_upper:
            signal["sentiment"] = "BEARISH"
            signal["confidence"] = 0.75
        elif "NEUTRAL" in text_upper:
            signal["sentiment"] = "NEUTRAL"
            signal["confidence"] = 0.5

        # Detect action
        if "BUY" in text_upper or signal["sentiment"] == "BULLISH":
            signal["action"] = "BUY"
        elif "SELL" in text_upper or signal["sentiment"] == "BEARISH":
            signal["action"] = "SELL"
        else:
            signal["action"] = "HOLD"

        return signal

    def execute_batch_trading(
        self,
        symbols: List[str],
        auto_execute: bool = False,
    ) -> Dict[str, Any]:
        """
        Complete workflow: Analyze symbols -> Get results -> Execute trades.

        Args:
            symbols: Symbols to analyze
            auto_execute: Automatically execute trades based on signals

        Returns:
            Trading execution results
        """
        log.info(f"Starting batch trading workflow for {len(symbols)} symbols")

        # Prepare batch
        batch_result = self.prepare_symbol_batch(symbols)

        if batch_result["status"] != "submitted":
            return {"status": "error", "message": "Failed to submit batch"}

        batch_id = batch_result["batch_id"]

        return {
            "status": "batch_submitted",
            "batch_id": batch_id,
            "symbols": symbols,
            "next_step": f"Check results with: get_batch_results('{batch_id}')",
            "submitted_at": datetime.utcnow().isoformat(),
        }

    def get_pending_batches(self) -> Dict[str, Dict[str, Any]]:
        """Get all pending batch jobs."""
        return self.pending_batches.copy()

    def cancel_batch(self, batch_id: str) -> Dict[str, Any]:
        """Cancel a pending batch."""
        result = self.processor.cancel_batch(batch_id)

        if result["status"] == "cancelled" and batch_id in self.pending_batches:
            self.pending_batches[batch_id]["status"] = "cancelled"

        return result


if __name__ == "__main__":
    # Example usage
    engine = BatchTradingEngine()

    # Analyze multiple symbols
    result = engine.execute_batch_trading(
        symbols=["BTC/USDT", "ETH/USDT", "SOL/USDT"],
        auto_execute=False,
    )

    print(f"Batch submission: {json.dumps(result, indent=2)}")

    # Later, check results
    if result["status"] == "batch_submitted":
        batch_id = result["batch_id"]
        print(f"\nBatch ID: {batch_id}")
        print("To get results, call: engine.get_batch_results(batch_id)")
