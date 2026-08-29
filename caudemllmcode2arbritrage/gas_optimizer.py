# src/utils/gas_optimizer.py
# ─────────────────────────────────────────────────────────────────────────────
# Multi-chain gas optimizer
# Each chain has different gas mechanics:
#   Ethereum  — EIP-1559 (base fee + priority fee)
#   Polygon   — EIP-1559 (very low base)
#   Cronos    — Legacy gas price
#   Arbitrum  — L2 pricing (very low)
#   Base      — L2 pricing (lowest)
#   BSC       — Legacy fixed gas price
#   Avalanche — EIP-1559 like
# ─────────────────────────────────────────────────────────────────────────────

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from typing import Optional
from web3 import Web3

# ── Gas buffer config per chain ───────────────────────────────────────────────
# How much extra to add above base gas price (to ensure inclusion)
GAS_BUFFERS = {
    "ethereum":  0.15,    # 15% — competitive mempool
    "polygon":   0.10,    # 10% — fast block times
    "cronos":    0.05,    # 5%  — very low competition
    "arbitrum":  0.05,    # 5%  — L2, deterministic
    "base":      0.05,    # 5%  — L2, deterministic
    "bsc":       0.10,    # 10% — can spike during congestion
    "avalanche": 0.10,    # 10% — C-chain can congest
}

DEFAULT_BUFFER = 0.20   # Fallback for unknown chains


def get_optimal_gas_price(w3: Web3, chain_key: str = "ethereum") -> int:
    """
    Fetches current gas price and adds a chain-appropriate buffer.
    Works with both EIP-1559 and legacy gas pricing.
    
    Args:
        w3: Connected Web3 instance for the target chain
        chain_key: Chain name from config e.g. "cronos", "base"
    Returns:
        Recommended gas price in wei (integer)
    
    Example:
        w3 = Web3(Web3.HTTPProvider(CRONOS_RPC))
        gas = get_optimal_gas_price(w3, "cronos")
        # → 2100000000 (2.1 Gwei)
    """
    buffer = GAS_BUFFERS.get(chain_key, DEFAULT_BUFFER)

    try:
        # Try EIP-1559 first (Ethereum, Polygon, Base, Arbitrum, Avalanche)
        latest_block = w3.eth.get_block("latest")
        if "baseFeePerGas" in latest_block:
            base_fee      = latest_block["baseFeePerGas"]
            priority_fee  = w3.eth.max_priority_fee
            max_fee       = int((base_fee + priority_fee) * (1 + buffer))
            print(
                f"[GAS:{chain_key}] EIP-1559  "
                f"base={Web3.from_wei(base_fee, 'gwei'):.3f} Gwei  "
                f"priority={Web3.from_wei(priority_fee, 'gwei'):.3f} Gwei  "
                f"max={Web3.from_wei(max_fee, 'gwei'):.3f} Gwei"
            )
            return max_fee

        # Legacy gas price (Cronos, BSC)
        gas_price   = w3.eth.gas_price
        buffered    = int(gas_price * (1 + buffer))
        print(
            f"[GAS:{chain_key}] Legacy  "
            f"base={Web3.from_wei(gas_price, 'gwei'):.3f} Gwei  "
            f"buffered={Web3.from_wei(buffered, 'gwei'):.3f} Gwei"
        )
        return buffered

    except Exception as e:
        print(f"[GAS:{chain_key}] Error fetching gas price: {e}")
        # Return a safe fallback rather than crashing
        fallback_gwei = _get_safe_fallback_gwei(chain_key)
        print(f"[GAS:{chain_key}] Using fallback: {fallback_gwei} Gwei")
        return Web3.to_wei(fallback_gwei, "gwei")


def _get_safe_fallback_gwei(chain_key: str) -> float:
    """
    Safe fallback gas price if RPC is unavailable.
    Values are conservative (higher than typical) to ensure inclusion.
    """
    FALLBACKS = {
        "ethereum":  50.0,    # Gwei — conservative mainnet
        "polygon":    50.0,
        "cronos":     5.0,    # Very cheap
        "arbitrum":   0.3,    # L2
        "base":       0.1,    # L2 — cheapest
        "bsc":        5.0,
        "avalanche": 30.0,
    }
    return FALLBACKS.get(chain_key, 30.0)


def estimate_gas_cost_usd(
    chain_key: str,
    gas_units: int = 300_000,
    native_price_usd: float = 1.0
) -> float:
    """
    Estimates the USD cost of a transaction without needing a live RPC.
    Uses chain registry average gas price as a baseline.
    
    Useful for pre-flight profitability checks before building a transaction.
    
    Args:
        chain_key: Chain name e.g. "cronos"
        gas_units: Estimated gas units for the transaction (default 300k = typical swap)
        native_price_usd: Current price of the chain's native token in USD
    Returns:
        Estimated gas cost in USD (float)
    
    Example:
        cost = estimate_gas_cost_usd("cronos", gas_units=300_000, native_price_usd=0.12)
        # → $0.0018
    """
    try:
        from chains import CHAINS
    except ImportError:
        from config.chains import CHAINS
    chain = CHAINS.get(chain_key, {})
    avg   = chain.get("avg_gas_usd", 0.10)

    # Simple estimate — use registry average if native price not provided
    if native_price_usd == 1.0:
        return avg

    # More accurate: gas_units * gwei_price * native_price
    fallback_gwei = _get_safe_fallback_gwei(chain_key)
    gas_cost_native = (gas_units * Web3.to_wei(fallback_gwei, "gwei")) / 1e18
    gas_cost_usd    = gas_cost_native * native_price_usd

    print(
        f"[GAS ESTIMATE:{chain_key}]  "
        f"units={gas_units:,}  "
        f"gwei={fallback_gwei}  "
        f"native_cost={gas_cost_native:.6f}  "
        f"usd=${gas_cost_usd:.4f}"
    )
    return round(gas_cost_usd, 6)


def is_trade_profitable(
    gross_profit_usd: float,
    chain_key_buy: str,
    chain_key_sell: str,
    gas_units: int = 300_000,
    native_buy_price: float = 1.0,
    native_sell_price: float = 1.0,
    min_net_profit_usd: float = 2.0
) -> dict:
    """
    Gate check: is a trade profitable after gas on both chains?
    
    Args:
        gross_profit_usd: Expected gross profit in USD
        chain_key_buy: Chain where we buy e.g. "cronos"
        chain_key_sell: Chain where we sell e.g. "arbitrum"
        gas_units: Estimated gas per transaction
        native_buy_price: USD price of buy chain native token
        native_sell_price: USD price of sell chain native token
        min_net_profit_usd: Minimum acceptable net profit
    Returns:
        dict with profitable flag and breakdown
    """
    gas_buy  = estimate_gas_cost_usd(chain_key_buy,  gas_units, native_buy_price)
    gas_sell = estimate_gas_cost_usd(chain_key_sell, gas_units, native_sell_price)
    total_gas = gas_buy + gas_sell
    net_profit = gross_profit_usd - total_gas

    result = {
        "gross_profit_usd": round(gross_profit_usd, 4),
        "gas_buy_usd":      round(gas_buy,          4),
        "gas_sell_usd":     round(gas_sell,          4),
        "total_gas_usd":    round(total_gas,         4),
        "net_profit_usd":   round(net_profit,        4),
        "profitable":       net_profit >= min_net_profit_usd,
    }

    flag = "✅ PROFITABLE" if result["profitable"] else "❌ NOT PROFITABLE"
    print(
        f"[GATE:{chain_key_buy}→{chain_key_sell}]  "
        f"gross=${gross_profit_usd:.2f}  gas=${total_gas:.4f}  "
        f"net=${net_profit:.2f}  {flag}"
    )
    return result


# ── Run directly for testing ──────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "="*65)
    print("GAS OPTIMIZER TEST (offline estimates)")
    print("="*65)

    chains = ["ethereum", "polygon", "cronos", "arbitrum", "base", "bsc", "avalanche"]
    print(f"\n{'Chain':<14} {'Fallback Gwei':<16} {'Est cost (300k gas)'}")
    print("-"*50)
    for c in chains:
        gwei = _get_safe_fallback_gwei(c)
        cost = estimate_gas_cost_usd(c, 300_000, 1.0)
        print(f"  {c:<12}  {gwei:<16.2f}  ~${cost:.4f}")

    print("\n── Profitability gate test ──────────────────────────────────")
    is_trade_profitable(
        gross_profit_usd=5.00,
        chain_key_buy="cronos",
        chain_key_sell="arbitrum",
        min_net_profit_usd=2.0
    )
    is_trade_profitable(
        gross_profit_usd=0.50,
        chain_key_buy="ethereum",
        chain_key_sell="polygon",
        min_net_profit_usd=2.0
    )
    print("="*65 + "\n")
