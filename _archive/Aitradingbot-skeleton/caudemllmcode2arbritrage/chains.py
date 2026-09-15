# config/chains.py
# ─────────────────────────────────────────────────────────────────────────────
# CHAIN REGISTRY — single source of truth for every chain in the bot
# Add a new chain here and it automatically propagates to all scanners
#
# Low-fee chains ranked by typical gas cost (Apr 2026):
#   Base      ~$0.001   Coinbase L2, very high liquidity
#   Cronos    ~$0.002   Crypto.com chain, underutilised arb opportunities
#   Arbitrum  ~$0.03    Ethereum L2, deep Uniswap V3 liquidity
#   BSC       ~$0.10    Pancakeswap, massive retail volume
#   Polygon   ~$0.01    Established, your current chain
#   Avalanche ~$0.05    C-Chain, Trader Joe + GMX
# ─────────────────────────────────────────────────────────────────────────────

import os
from dotenv import load_dotenv
load_dotenv()

CHAINS = {

    # ── Ethereum (mainnet reference — high fees, used as price benchmark) ────
    "ethereum": {
        "name":             "Ethereum",
        "chain_id":         1,
        "rpc_env_key":      "INFURA_URL",
        "rpc_fallback":     "https://rpc.ankr.com/eth",
        "dexscreener_id":   "ethereum",
        "native_token":     "ETH",
        "native_decimals":  18,
        "avg_gas_usd":      2.50,       # Rough average per swap (Apr 2026)
        "enabled":          True,
        "primary_dex":      "uniswap_v3",
        "router":           "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        "weth_address":     "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        "usdc_address":     "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "explorer":         "https://etherscan.io",
        "color":            "⚪",        # Terminal colour label
    },

    # ── Polygon (existing) ───────────────────────────────────────────────────
    "polygon": {
        "name":             "Polygon",
        "chain_id":         137,
        "rpc_env_key":      "POLYGON_RPC",
        "rpc_fallback":     "https://polygon-rpc.com",
        "dexscreener_id":   "polygon",
        "native_token":     "MATIC",
        "native_decimals":  18,
        "avg_gas_usd":      0.01,
        "enabled":          True,
        "primary_dex":      "quickswap",
        "router":           "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
        "weth_address":     "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",  # WMATIC
        "usdc_address":     "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
        "explorer":         "https://polygonscan.com",
        "color":            "🟣",
    },

    # ── Cronos — NEW ─────────────────────────────────────────────────────────
    "cronos": {
        "name":             "Cronos",
        "chain_id":         25,
        "rpc_env_key":      "CRONOS_RPC",
        "rpc_fallback":     "https://evm.cronos.org",
        "dexscreener_id":   "cronos",
        "native_token":     "CRO",
        "native_decimals":  18,
        "avg_gas_usd":      0.002,      # Extremely low — good arb target
        "enabled":          True,
        "primary_dex":      "vvs_finance",
        "secondary_dex":    "mm_finance",
        "router":           "0x145677FC4d9b8F19B5D56d1820c48e0443049a30",  # VVS
        "weth_address":     "0x5C7F8A570d578ED84E63fdFA7b1eE72dEae1AE23",  # WCRO
        "usdc_address":     "0xc21223249CA28397B4B6541dfFaEcC539BfF0c59",  # USDC.e
        "explorer":         "https://cronoscan.com",
        "color":            "🔵",
        "notes":            "Low competition, underused — good arb window",
    },

    # ── Arbitrum — NEW ───────────────────────────────────────────────────────
    "arbitrum": {
        "name":             "Arbitrum One",
        "chain_id":         42161,
        "rpc_env_key":      "ARBITRUM_RPC",
        "rpc_fallback":     "https://arb1.arbitrum.io/rpc",
        "dexscreener_id":   "arbitrum",
        "native_token":     "ETH",
        "native_decimals":  18,
        "avg_gas_usd":      0.03,
        "enabled":          True,
        "primary_dex":      "uniswap_v3",
        "secondary_dex":    "camelot",
        "router":           "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        "weth_address":     "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        "usdc_address":     "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
        "explorer":         "https://arbiscan.io",
        "color":            "🔷",
    },

    # ── Base — NEW ───────────────────────────────────────────────────────────
    "base": {
        "name":             "Base",
        "chain_id":         8453,
        "rpc_env_key":      "BASE_RPC",
        "rpc_fallback":     "https://mainnet.base.org",
        "dexscreener_id":   "base",
        "native_token":     "ETH",
        "native_decimals":  18,
        "avg_gas_usd":      0.001,      # Cheapest L2 currently
        "enabled":          True,
        "primary_dex":      "baseswap",
        "secondary_dex":    "aerodrome",
        "router":           "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86",  # BaseSwap
        "weth_address":     "0x4200000000000000000000000000000000000006",
        "usdc_address":     "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "explorer":         "https://basescan.org",
        "color":            "🟦",
        "notes":            "Coinbase L2 — growing liquidity, very low fees",
    },

    # ── BSC — NEW ────────────────────────────────────────────────────────────
    "bsc": {
        "name":             "BNB Chain",
        "chain_id":         56,
        "rpc_env_key":      "BSC_RPC",
        "rpc_fallback":     "https://bsc-dataseed1.binance.org",
        "dexscreener_id":   "bsc",
        "native_token":     "BNB",
        "native_decimals":  18,
        "avg_gas_usd":      0.10,
        "enabled":          True,
        "primary_dex":      "pancakeswap_v3",
        "secondary_dex":    "biswap",
        "router":           "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",  # PCS V3
        "weth_address":     "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",  # WBNB
        "usdc_address":     "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        "explorer":         "https://bscscan.com",
        "color":            "🟡",
    },

    # ── Avalanche — NEW ──────────────────────────────────────────────────────
    "avalanche": {
        "name":             "Avalanche C-Chain",
        "chain_id":         43114,
        "rpc_env_key":      "AVALANCHE_RPC",
        "rpc_fallback":     "https://api.avax.network/ext/bc/C/rpc",
        "dexscreener_id":   "avalanche",
        "native_token":     "AVAX",
        "native_decimals":  18,
        "avg_gas_usd":      0.05,
        "enabled":          True,
        "primary_dex":      "trader_joe",
        "secondary_dex":    "pangolin",
        "router":           "0x60aE616a2155Ee3d9A68541Ba4544862310933d4",  # Trader Joe
        "weth_address":     "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",  # WAVAX
        "usdc_address":     "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
        "explorer":         "https://snowtrace.io",
        "color":            "🔴",
    },

}


# ── Helper functions ──────────────────────────────────────────────────────────

def get_enabled_chains() -> dict:
    """Returns only chains marked enabled=True"""
    return {k: v for k, v in CHAINS.items() if v.get("enabled", False)}


def get_rpc(chain_key: str) -> str:
    """
    Returns RPC URL for a chain.
    Reads from environment variable first, falls back to public RPC.
    
    Args:
        chain_key: Chain name e.g. "cronos", "base"
    Returns:
        RPC URL string
    """
    chain = CHAINS.get(chain_key)
    if not chain:
        raise KeyError(f"Unknown chain: {chain_key}")
    env_key  = chain.get("rpc_env_key", "")
    env_val  = os.getenv(env_key, "")
    return env_val if env_val else chain["rpc_fallback"]


def get_low_fee_chains(max_gas_usd: float = 0.10) -> dict:
    """
    Returns chains where average gas cost is below threshold.
    
    Args:
        max_gas_usd: Maximum acceptable gas cost per swap in USD
    Returns:
        Filtered chain dict
    """
    return {
        k: v for k, v in CHAINS.items()
        if v.get("enabled") and v.get("avg_gas_usd", 999) <= max_gas_usd
    }


def chain_summary() -> None:
    """Prints a formatted summary of all chains and their gas costs."""
    print("\n" + "="*65)
    print(f"{'CHAIN REGISTRY':^65}")
    print("="*65)
    print(f"  {'Chain':<18} {'Native':<8} {'Gas(USD)':<12} {'DEX':<20} {'Status'}")
    print("-"*65)
    for key, c in CHAINS.items():
        status = "✅ ON" if c.get("enabled") else "⏸  OFF"
        gas    = f"~${c.get('avg_gas_usd', '?'):.3f}"
        print(
            f"  {c['color']} {c['name']:<16} {c['native_token']:<8} "
            f"{gas:<12} {c.get('primary_dex','?'):<20} {status}"
        )
    print("="*65 + "\n")


# ── Tokens to scan across chains ─────────────────────────────────────────────
# DexScreener chain-agnostic token symbols to scan for arb
SCAN_PAIRS = [
    "WETH/USDC",
    "WBTC/USDC",
    "LINK/USDC",
    "AAVE/USDC",
    "UNI/USDC",
    "CRO/USDC",    # Cronos native
    "MATIC/USDC",  # Polygon native
    "BNB/USDC",    # BSC native
    "AVAX/USDC",   # Avalanche native
]


if __name__ == "__main__":
    chain_summary()
    print("Low-fee chains (gas < $0.05):")
    for k, v in get_low_fee_chains(0.05).items():
        print(f"  {v['color']} {v['name']} — avg ${v['avg_gas_usd']:.3f}/swap")
