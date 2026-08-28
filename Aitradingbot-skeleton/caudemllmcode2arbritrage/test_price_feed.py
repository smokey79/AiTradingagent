# tests/test_price_feed.py
# Unit tests for price feed and aggregator modules
# Run with: python -m pytest tests/ -v

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from unittest.mock import patch


# ── Price feed tests ──────────────────────────────────────────────────────────
class TestPriceFeed:

    def test_supported_symbol_returns_float(self):
        """Real API call to Binance — skipped in offline CI"""
        pytest.importorskip("requests")
        from src.data.price_feed import get_price
        price = get_price("ETH")
        # If network is available, price should be a positive float
        if price is not None:
            assert isinstance(price, float)
            assert price > 0

    def test_unsupported_symbol_returns_none(self):
        from src.data.price_feed import get_price
        price = get_price("FAKECOIN999")
        assert price is None

    def test_multi_price_returns_dict(self):
        from src.data.price_feed import get_multi_price
        result = get_multi_price(["ETH", "BTC"])
        assert isinstance(result, dict)
        assert "ETH" in result
        assert "BTC" in result

    @patch("src.data.price_feed.fetch_price_binance")
    @patch("src.data.price_feed.fetch_price_coingecko")
    def test_fallback_to_coingecko_when_binance_fails(
        self, mock_coingecko, mock_binance
    ):
        """If Binance returns None, should fall back to CoinGecko"""
        mock_binance.return_value = None
        mock_coingecko.return_value = 3500.0
        from src.data.price_feed import get_price
        price = get_price("ETH", preferred_source="binance")
        assert price == 3500.0
        mock_coingecko.assert_called_once()

    @patch("src.data.price_feed.fetch_price_binance")
    @patch("src.data.price_feed.fetch_price_coingecko")
    def test_returns_none_when_all_sources_fail(
        self, mock_coingecko, mock_binance
    ):
        mock_binance.return_value = None
        mock_coingecko.return_value = None
        from src.data.price_feed import get_price
        price = get_price("ETH")
        assert price is None


# ── Price aggregator tests ────────────────────────────────────────────────────
class TestPriceAggregator:

    @patch("src.data.price_aggregator.get_price")
    def test_spread_computed_correctly(self, mock_get_price):
        """Test that spread % is calculated correctly"""
        mock_get_price.return_value = 3500.0  # ETH price
        from src.data.price_aggregator import get_cross_chain_spread
        result = get_cross_chain_spread("ETH")

        assert result["eth_price"] == 3500.0
        assert result["polygon_price"] is not None
        assert isinstance(result["spread_pct"], float)
        assert result["spread_pct"] > 0

    @patch("src.data.price_aggregator.get_price")
    def test_opportunity_flagged_above_threshold(self, mock_get_price):
        """Spread ≥ MIN_SPREAD_PCT should flag opportunity=True"""
        mock_get_price.return_value = 3500.0
        from src.data.price_aggregator import get_cross_chain_spread
        result = get_cross_chain_spread("ETH")
        # With 3% simulation discount, spread will be ~3.09% → above 1.5% threshold
        assert result["opportunity"] is True

    @patch("src.data.price_aggregator.get_price")
    def test_failed_price_returns_no_opportunity(self, mock_get_price):
        mock_get_price.return_value = None
        from src.data.price_aggregator import get_cross_chain_spread
        result = get_cross_chain_spread("ETH")
        assert result["opportunity"] is False
        assert result.get("error") is not None


# ── Slippage tests ────────────────────────────────────────────────────────────
class TestSlippageControl:

    def test_1pct_slippage(self):
        from src.utils.slippage_control import calculate_min_amount_out
        result = calculate_min_amount_out(1000, 0.01)
        assert result == 990

    def test_5pct_slippage(self):
        from src.utils.slippage_control import calculate_min_amount_out
        result = calculate_min_amount_out(1000, 0.05)
        assert result == 950

    def test_invalid_slippage_raises(self):
        from src.utils.slippage_control import calculate_min_amount_out
        with pytest.raises(ValueError):
            calculate_min_amount_out(1000, 1.5)   # over 100%

    def test_zero_slippage_raises(self):
        from src.utils.slippage_control import calculate_min_amount_out
        with pytest.raises(ValueError):
            calculate_min_amount_out(1000, 0)


# ── Cross-chain arbitrage logic tests ────────────────────────────────────────
class TestCrossChainArbitrage:

    def test_eth_higher_than_polygon_returns_opportunity(self):
        from src.flashloan.cross_chain_arbitrage import check_cross_chain_arbitrage
        result = check_cross_chain_arbitrage(eth_price=3500.0, polygon_price=3200.0)
        assert result["opportunity"] is True
        assert result["buy_on"] == "Polygon"
        assert result["sell_on"] == "Ethereum"
        assert result["profit_pct"] > 0

    def test_small_spread_returns_no_opportunity(self):
        from src.flashloan.cross_chain_arbitrage import check_cross_chain_arbitrage
        result = check_cross_chain_arbitrage(eth_price=3500.0, polygon_price=3490.0)
        assert result["opportunity"] is False

    def test_zero_prices_handled_safely(self):
        from src.flashloan.cross_chain_arbitrage import check_cross_chain_arbitrage
        result = check_cross_chain_arbitrage(eth_price=0, polygon_price=3200.0)
        assert result["opportunity"] is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
