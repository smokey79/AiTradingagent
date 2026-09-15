# tests/test_multichain.py
# Unit tests for multi-chain arbitrage, gas optimizer, and chain registry
# Run with: python -m pytest tests/ -v

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from unittest.mock import patch, MagicMock


# ─────────────────────────────────────────────────────────────────────────────
# Chain registry tests
# ─────────────────────────────────────────────────────────────────────────────
class TestChainRegistry:

    def test_all_expected_chains_present(self):
        from config.chains import CHAINS
        expected = ["ethereum", "polygon", "cronos", "arbitrum", "base", "bsc", "avalanche"]
        for chain in expected:
            assert chain in CHAINS, f"Missing chain: {chain}"

    def test_cronos_chain_has_required_fields(self):
        from config.chains import CHAINS
        cronos = CHAINS["cronos"]
        required = ["name", "chain_id", "rpc_fallback", "dexscreener_id",
                    "native_token", "avg_gas_usd", "primary_dex", "router",
                    "weth_address", "usdc_address"]
        for field in required:
            assert field in cronos, f"Cronos missing field: {field}"

    def test_cronos_chain_id_correct(self):
        from config.chains import CHAINS
        assert CHAINS["cronos"]["chain_id"] == 25

    def test_base_chain_id_correct(self):
        from config.chains import CHAINS
        assert CHAINS["base"]["chain_id"] == 8453

    def test_get_enabled_chains_returns_only_enabled(self):
        from config.chains import get_enabled_chains, CHAINS
        enabled = get_enabled_chains()
        for key in enabled:
            assert CHAINS[key]["enabled"] is True

    def test_get_low_fee_chains_filters_correctly(self):
        from config.chains import get_low_fee_chains
        cheap = get_low_fee_chains(max_gas_usd=0.05)
        for key, chain in cheap.items():
            assert chain["avg_gas_usd"] <= 0.05, f"{key} gas ${chain['avg_gas_usd']} exceeds threshold"

    def test_cronos_is_low_fee(self):
        from config.chains import get_low_fee_chains
        cheap = get_low_fee_chains(max_gas_usd=0.05)
        assert "cronos" in cheap

    def test_base_is_low_fee(self):
        from config.chains import get_low_fee_chains
        cheap = get_low_fee_chains(max_gas_usd=0.05)
        assert "base" in cheap

    def test_get_rpc_uses_fallback_when_env_missing(self):
        from config.chains import get_rpc
        # With no env variable set, should return fallback
        with patch.dict(os.environ, {}, clear=True):
            rpc = get_rpc("cronos")
            assert rpc == "https://evm.cronos.org"

    def test_get_rpc_unknown_chain_raises(self):
        from config.chains import get_rpc
        with pytest.raises(KeyError):
            get_rpc("notachain")


# ─────────────────────────────────────────────────────────────────────────────
# Cross-chain arbitrage tests
# ─────────────────────────────────────────────────────────────────────────────
class TestCrossChainArbitrage:

    def test_legacy_two_chain_opportunity(self):
        from src.flashloan.cross_chain_arbitrage import check_cross_chain_arbitrage
        result = check_cross_chain_arbitrage(3500.0, 3200.0)
        assert result["opportunity"] is True
        assert result["buy_on"] == "Polygon"
        assert result["sell_on"] == "Ethereum"

    def test_legacy_small_spread_no_opportunity(self):
        from src.flashloan.cross_chain_arbitrage import check_cross_chain_arbitrage
        result = check_cross_chain_arbitrage(3500.0, 3495.0)
        assert result["opportunity"] is False

    def test_legacy_zero_price_safe(self):
        from src.flashloan.cross_chain_arbitrage import check_cross_chain_arbitrage
        result = check_cross_chain_arbitrage(0, 3200.0)
        assert result["opportunity"] is False

    def test_find_best_arb_pair_returns_sorted_list(self):
        from src.flashloan.cross_chain_arbitrage import find_best_arb_pair
        prices = {
            "cronos":   {"price_usd": 3400.0, "liquidity": 200_000, "volume_24h": 500_000, "dex": "vvs"},
            "ethereum": {"price_usd": 3521.0, "liquidity": 5_000_000, "volume_24h": 20_000_000, "dex": "uni"},
            "arbitrum": {"price_usd": 3519.0, "liquidity": 2_000_000, "volume_24h": 8_000_000, "dex": "uni"},
        }
        opps = find_best_arb_pair(prices, "ETH")
        assert isinstance(opps, list)
        # If opportunities found, they should be sorted descending by net_pct
        for i in range(len(opps) - 1):
            assert opps[i]["net_pct"] >= opps[i + 1]["net_pct"]

    def test_find_best_arb_pair_fields_present(self):
        from src.flashloan.cross_chain_arbitrage import find_best_arb_pair
        prices = {
            "cronos":   {"price_usd": 3300.0, "liquidity": 200_000, "volume_24h": 500_000, "dex": "vvs"},
            "arbitrum": {"price_usd": 3521.0, "liquidity": 2_000_000, "volume_24h": 8_000_000, "dex": "uni"},
        }
        opps = find_best_arb_pair(prices, "ETH")
        if opps:
            opp = opps[0]
            required = ["token", "buy_chain", "sell_chain", "buy_price",
                        "sell_price", "gross_pct", "gas_cost_pct", "net_pct"]
            for field in required:
                assert field in opp, f"Missing field: {field}"

    def test_single_chain_returns_empty(self):
        from src.flashloan.cross_chain_arbitrage import find_best_arb_pair
        prices = {
            "cronos": {"price_usd": 3400.0, "liquidity": 200_000, "volume_24h": 500_000, "dex": "vvs"},
        }
        opps = find_best_arb_pair(prices, "ETH")
        assert opps == []

    def test_all_zero_prices_returns_empty(self):
        from src.flashloan.cross_chain_arbitrage import find_best_arb_pair
        prices = {
            "cronos":   {"price_usd": 0, "liquidity": 0, "volume_24h": 0, "dex": "vvs"},
            "arbitrum": {"price_usd": 0, "liquidity": 0, "volume_24h": 0, "dex": "uni"},
        }
        opps = find_best_arb_pair(prices, "ETH")
        assert opps == []


# ─────────────────────────────────────────────────────────────────────────────
# Gas optimizer tests
# ─────────────────────────────────────────────────────────────────────────────
class TestGasOptimizer:

    def test_estimate_gas_cost_cronos_is_cheap(self):
        from src.utils.gas_optimizer import estimate_gas_cost_usd
        cost = estimate_gas_cost_usd("cronos", 300_000, 1.0)
        # Cronos registry avg is $0.002 — should be very cheap
        assert cost < 0.05, f"Cronos gas estimate too high: ${cost}"

    def test_estimate_gas_cost_base_is_cheapest(self):
        from src.utils.gas_optimizer import estimate_gas_cost_usd
        cronos_cost = estimate_gas_cost_usd("cronos",   300_000, 1.0)
        eth_cost    = estimate_gas_cost_usd("ethereum", 300_000, 1.0)
        assert eth_cost > cronos_cost, "Ethereum should be more expensive than Cronos"

    def test_profitable_trade_passes_gate(self):
        from src.utils.gas_optimizer import is_trade_profitable
        result = is_trade_profitable(
            gross_profit_usd   = 50.0,
            chain_key_buy      = "cronos",
            chain_key_sell     = "base",
            min_net_profit_usd = 2.0,
        )
        assert result["profitable"] is True

    def test_unprofitable_trade_fails_gate(self):
        from src.utils.gas_optimizer import is_trade_profitable
        result = is_trade_profitable(
            gross_profit_usd   = 0.10,
            chain_key_buy      = "ethereum",
            chain_key_sell     = "polygon",
            min_net_profit_usd = 2.0,
        )
        assert result["profitable"] is False

    def test_gate_result_has_required_fields(self):
        from src.utils.gas_optimizer import is_trade_profitable
        result = is_trade_profitable(5.0, "cronos", "arbitrum")
        for field in ["gross_profit_usd", "gas_buy_usd", "gas_sell_usd",
                      "total_gas_usd", "net_profit_usd", "profitable"]:
            assert field in result


# ─────────────────────────────────────────────────────────────────────────────
# DexScreener feed tests (mocked — no real network call)
# ─────────────────────────────────────────────────────────────────────────────
class TestDexScreenerFeed:

    def _make_mock_pair(self, chain, price, liquidity=500_000, volume=100_000, dex="testdex"):
        return {
            "chainId":    chain,
            "dexId":      dex,
            "pairAddress":"0xABCDEF",
            "baseToken":  {"symbol": "ETH", "address": "0x123"},
            "quoteToken": {"symbol": "USDC"},
            "priceUsd":   str(price),
            "liquidity":  {"usd": liquidity},
            "volume":     {"h24": volume},
            "priceChange":{"h1": 0.1},
        }

    @patch("src.data.dexscreener_feed._get")
    def test_search_pairs_filters_by_chain(self, mock_get):
        mock_get.return_value = {
            "pairs": [
                self._make_mock_pair("cronos",   3400.0, 500_000),
                self._make_mock_pair("ethereum", 3521.0, 5_000_000),
            ]
        }
        from src.data.dexscreener_feed import search_pairs
        result = search_pairs("ETH", chain_filter="cronos")
        assert all(p["chainId"] == "cronos" for p in result)

    @patch("src.data.dexscreener_feed._get")
    def test_search_pairs_filters_low_liquidity(self, mock_get):
        mock_get.return_value = {
            "pairs": [
                self._make_mock_pair("cronos", 3400.0, liquidity=500),  # below threshold
            ]
        }
        from src.data.dexscreener_feed import search_pairs
        result = search_pairs("ETH", chain_filter="cronos")
        assert result == []

    @patch("src.data.dexscreener_feed._get")
    def test_search_returns_empty_on_api_failure(self, mock_get):
        mock_get.return_value = None
        from src.data.dexscreener_feed import search_pairs
        result = search_pairs("ETH")
        assert result == []

    @patch("src.data.dexscreener_feed._get")
    def test_get_pair_data_returns_none_below_liquidity(self, mock_get):
        mock_get.return_value = {
            "pairs": [self._make_mock_pair("cronos", 3400.0, liquidity=1000)]
        }
        from src.data.dexscreener_feed import get_pair_data
        result = get_pair_data("cronos", "0xABCDEF")
        assert result is None


# ─────────────────────────────────────────────────────────────────────────────
# Slippage tests (carried forward)
# ─────────────────────────────────────────────────────────────────────────────
class TestSlippageControl:

    def test_1pct(self):
        from src.utils.slippage_control import calculate_min_amount_out
        assert calculate_min_amount_out(1000, 0.01) == 990

    def test_5pct(self):
        from src.utils.slippage_control import calculate_min_amount_out
        assert calculate_min_amount_out(1000, 0.05) == 950

    def test_invalid_raises(self):
        from src.utils.slippage_control import calculate_min_amount_out
        with pytest.raises(ValueError):
            calculate_min_amount_out(1000, 1.5)

    def test_zero_raises(self):
        from src.utils.slippage_control import calculate_min_amount_out
        with pytest.raises(ValueError):
            calculate_min_amount_out(1000, 0)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
