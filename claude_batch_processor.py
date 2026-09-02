"""
claude_batch_processor.py
=========================
Processes multiple market analysis requests using Claude Batch API.
Efficient for bulk analysis of trading signals, market data, and strategies.
"""

import os
import logging
import json
from typing import Dict, List, Optional, Any
from datetime import datetime
import anthropic

log = logging.getLogger("ClaudeBatchProcessor")


class ClaudeBatchProcessor:
    """
    Process multiple market analysis requests efficiently using Claude Batch API.
    Ideal for analyzing multiple symbols, timeframes, and strategies in one batch.
    """

    def __init__(self, api_key: str = None):
        """
        Initialize Claude batch processor.

        Args:
            api_key: Anthropic API key (uses ANTHROPIC_API_KEY env var if not provided)
        """
        self.api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        self.client = anthropic.Anthropic(api_key=self.api_key)
        self.batch_requests = []
        self.batch_id = None

        log.info("Claude Batch Processor initialized")

    def add_signal_analysis_request(
        self,
        symbol: str,
        market_data: Dict[str, Any],
        custom_id: str = None,
        model: str = "claude-3-5-sonnet-20241022",
    ) -> str:
        """
        Add a market analysis request to the batch.

        Args:
            symbol: Trading pair (e.g., "BTC/USDT")
            market_data: Market data for analysis
            custom_id: Custom request ID (auto-generated if not provided)
            model: Claude model to use

        Returns:
            Request custom_id
        """
        if not custom_id:
            custom_id = f"analysis-{symbol}-{len(self.batch_requests)}"

        prompt = self._build_analysis_prompt(symbol, market_data)

        request = {
            "custom_id": custom_id,
            "params": {
                "model": model,
                "max_tokens": 500,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
            },
        }

        self.batch_requests.append(request)
        log.info(f"Added analysis request for {symbol} | ID: {custom_id}")
        return custom_id

    def add_strategy_evaluation_request(
        self,
        strategy_name: str,
        strategy_description: str,
        recent_performance: Dict[str, Any],
        custom_id: str = None,
        model: str = "claude-3-5-sonnet-20241022",
    ) -> str:
        """
        Add a strategy evaluation request to the batch.

        Args:
            strategy_name: Name of the strategy
            strategy_description: Description of strategy
            recent_performance: Recent performance metrics
            custom_id: Custom request ID
            model: Claude model to use

        Returns:
            Request custom_id
        """
        if not custom_id:
            custom_id = f"strategy-{strategy_name}-{len(self.batch_requests)}"

        prompt = f"""Analyze the following trading strategy and provide recommendations:

Strategy: {strategy_name}
Description: {strategy_description}

Recent Performance:
{json.dumps(recent_performance, indent=2)}

Please provide:
1. Overall assessment (Good/Fair/Poor)
2. Strengths
3. Weaknesses
4. Recommendations for improvement
5. Risk assessment
6. Suggested modifications

Keep response concise and actionable."""

        request = {
            "custom_id": custom_id,
            "params": {
                "model": model,
                "max_tokens": 500,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
            },
        }

        self.batch_requests.append(request)
        log.info(f"Added strategy evaluation for {strategy_name} | ID: {custom_id}")
        return custom_id

    def add_custom_request(
        self,
        prompt: str,
        custom_id: str,
        model: str = "claude-3-5-sonnet-20241022",
        max_tokens: int = 500,
    ) -> str:
        """
        Add a custom analysis request to the batch.

        Args:
            prompt: Analysis prompt
            custom_id: Request identifier
            model: Claude model to use
            max_tokens: Maximum tokens in response

        Returns:
            Request custom_id
        """
        request = {
            "custom_id": custom_id,
            "params": {
                "model": model,
                "max_tokens": max_tokens,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
            },
        }

        self.batch_requests.append(request)
        log.info(f"Added custom request | ID: {custom_id}")
        return custom_id

    def submit_batch(self) -> Dict[str, Any]:
        """
        Submit all queued requests as a batch to Claude.

        Returns:
            Batch information with ID and status
        """
        if not self.batch_requests:
            log.warning("No requests in batch")
            return {"status": "error", "message": "No requests queued"}

        try:
            batch = self.client.messages.batches.create(requests=self.batch_requests)

            self.batch_id = batch.id
            self.batch_requests = []  # Clear after submission

            log.info(
                f"Batch submitted successfully | ID: {batch.id} | "
                f"Requests: {batch.request_counts.processing}"
            )

            return {
                "status": "submitted",
                "batch_id": batch.id,
                "request_count": len(batch.request_counts),
                "created_at": batch.created_at,
            }

        except Exception as e:
            log.error(f"Error submitting batch: {e}")
            return {"status": "error", "message": str(e)}

    def get_batch_status(self, batch_id: str = None) -> Dict[str, Any]:
        """
        Check the status of a batch.

        Args:
            batch_id: Batch ID to check (uses last submitted if not provided)

        Returns:
            Batch status information
        """
        if not batch_id:
            batch_id = self.batch_id

        if not batch_id:
            return {"status": "error", "message": "No batch ID provided"}

        try:
            batch = self.client.messages.batches.retrieve(batch_id)

            return {
                "batch_id": batch.id,
                "status": batch.processing_status,
                "request_counts": {
                    "processing": batch.request_counts.processing,
                    "succeeded": batch.request_counts.succeeded,
                    "errored": batch.request_counts.errored,
                    "canceled": batch.request_counts.canceled,
                    "expired": batch.request_counts.expired,
                },
                "created_at": batch.created_at,
                "expires_at": batch.expires_at,
            }

        except Exception as e:
            log.error(f"Error retrieving batch status: {e}")
            return {"status": "error", "message": str(e)}

    def retrieve_batch_results(self, batch_id: str = None) -> Dict[str, Any]:
        """
        Retrieve results from a completed batch.

        Args:
            batch_id: Batch ID to retrieve (uses last submitted if not provided)

        Returns:
            Batch results organized by custom_id
        """
        if not batch_id:
            batch_id = self.batch_id

        if not batch_id:
            return {"status": "error", "message": "No batch ID provided"}

        try:
            results = {}
            error_count = 0

            for result in self.client.messages.batches.results(batch_id):
                custom_id = result.custom_id

                if result.result.type == "succeeded":
                    message = result.result.message
                    results[custom_id] = {
                        "status": "succeeded",
                        "content": message.content[0].text if message.content else "",
                        "usage": {
                            "input_tokens": message.usage.input_tokens,
                            "output_tokens": message.usage.output_tokens,
                        },
                    }
                elif result.result.type == "errored":
                    error_count += 1
                    results[custom_id] = {
                        "status": "errored",
                        "error": result.result.error.message,
                    }
                elif result.result.type == "expired":
                    results[custom_id] = {"status": "expired"}

            log.info(
                f"Retrieved batch results | ID: {batch_id} | "
                f"Succeeded: {len(results) - error_count} | Errors: {error_count}"
            )

            return {
                "batch_id": batch_id,
                "results": results,
                "summary": {
                    "total": len(results),
                    "succeeded": len(results) - error_count,
                    "errored": error_count,
                },
            }

        except Exception as e:
            log.error(f"Error retrieving batch results: {e}")
            return {"status": "error", "message": str(e)}

    def cancel_batch(self, batch_id: str = None) -> Dict[str, Any]:
        """
        Cancel a batch.

        Args:
            batch_id: Batch ID to cancel

        Returns:
            Cancellation status
        """
        if not batch_id:
            batch_id = self.batch_id

        if not batch_id:
            return {"status": "error", "message": "No batch ID provided"}

        try:
            batch = self.client.messages.batches.cancel(batch_id)
            log.info(f"Batch cancelled | ID: {batch_id}")
            return {"status": "cancelled", "batch_id": batch_id}

        except Exception as e:
            log.error(f"Error cancelling batch: {e}")
            return {"status": "error", "message": str(e)}

    def _build_analysis_prompt(self, symbol: str, market_data: Dict[str, Any]) -> str:
        """Build a market analysis prompt."""
        return f"""Analyze the following market data for {symbol} and provide a trading signal:

Market Data:
{json.dumps(market_data, indent=2)}

Please provide:
1. Market sentiment (BULLISH/BEARISH/NEUTRAL)
2. Technical analysis summary
3. Key support/resistance levels
4. Recommended action (BUY/SELL/HOLD)
5. Confidence level (0-100%)
6. Risk assessment
7. Price target
8. Stop loss recommendation

Format your response as a structured analysis."""

    def get_queued_requests_count(self) -> int:
        """Get number of requests currently queued."""
        return len(self.batch_requests)

    def clear_queue(self) -> None:
        """Clear all queued requests."""
        self.batch_requests = []
        log.info("Request queue cleared")


class TradingBatchAnalyzer:
    """
    Analyze multiple trading symbols and strategies using Claude batches.
    """

    def __init__(self):
        """Initialize trading batch analyzer."""
        self.processor = ClaudeBatchProcessor()
        self.analysis_history = []

    def analyze_multiple_symbols(
        self,
        symbols_data: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Analyze multiple trading symbols in one batch.

        Args:
            symbols_data: Dict of symbol -> market_data

        Returns:
            Batch submission result
        """
        log.info(f"Starting batch analysis for {len(symbols_data)} symbols")

        # Add all symbols to batch
        for symbol, data in symbols_data.items():
            self.processor.add_signal_analysis_request(symbol, data)

        # Submit batch
        result = self.processor.submit_batch()

        if result["status"] == "submitted":
            self.analysis_history.append({
                "timestamp": datetime.utcnow().isoformat(),
                "batch_id": result["batch_id"],
                "symbol_count": len(symbols_data),
                "symbols": list(symbols_data.keys()),
            })

        return result

    def evaluate_strategies(
        self,
        strategies: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Evaluate multiple trading strategies in one batch.

        Args:
            strategies: List of strategy evaluation requests

        Returns:
            Batch submission result
        """
        log.info(f"Starting batch evaluation for {len(strategies)} strategies")

        for strategy in strategies:
            self.processor.add_strategy_evaluation_request(
                strategy["name"],
                strategy["description"],
                strategy["performance"],
                custom_id=strategy.get("custom_id"),
            )

        result = self.processor.submit_batch()

        if result["status"] == "submitted":
            self.analysis_history.append({
                "timestamp": datetime.utcnow().isoformat(),
                "batch_id": result["batch_id"],
                "strategy_count": len(strategies),
                "strategies": [s["name"] for s in strategies],
            })

        return result

    def get_analysis_history(self) -> List[Dict[str, Any]]:
        """Get history of all batch analyses."""
        return self.analysis_history.copy()


if __name__ == "__main__":
    # Example usage
    processor = ClaudeBatchProcessor()

    # Add multiple analysis requests
    processor.add_signal_analysis_request(
        "BTC/USDT",
        {
            "price": 45000,
            "24h_change": 2.5,
            "volume": 32000000000,
            "rsi": 65,
            "macd": "bullish",
        },
    )

    processor.add_signal_analysis_request(
        "ETH/USDT",
        {
            "price": 2500,
            "24h_change": 1.8,
            "volume": 15000000000,
            "rsi": 58,
            "macd": "neutral",
        },
    )

    # Submit batch
    result = processor.submit_batch()
    print(f"Batch submitted: {result}")

    # Check status
    status = processor.get_batch_status()
    print(f"Batch status: {status}")
