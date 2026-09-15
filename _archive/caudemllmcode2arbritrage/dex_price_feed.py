# src/data/dex_price_feed.py
# On-chain price feed from Uniswap V2 and Sushiswap using Web3
# Used to get the REAL DEX price, not CEX price
# PAPER TRADE SAFE: read-only calls only

import os
import json
from typing import Optional
from web3 import Web3
from dotenv import load_dotenv

load_dotenv()

# ── RPC connections ───────────────────────────────────────────────────────────
ETHEREUM_RPC = os.getenv("INFURA_URL")
POLYGON_RPC  = os.getenv("POLYGON_RPC", "https://polygon-rpc.com")

w3_eth     = Web3(Web3.HTTPProvider(ETHEREUM_RPC)) if ETHEREUM_RPC else None
w3_polygon = Web3(Web3.HTTPProvider(POLYGON_RPC))

# ── Router addresses (public, no key needed) ──────────────────────────────────
UNISWAP_V2_ROUTER     = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"
SUSHISWAP_ETH_ROUTER  = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"
SUSHISWAP_POLY_ROUTER = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506"

# Well-known token addresses
TOKENS = {
    "WETH":  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",   # Ethereum
    "WMATIC":"0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",   # Polygon
    "USDC":  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",   # Ethereum USDC
    "USDC_POLY": "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", # Polygon USDC
}

# Minimal ABI — only getAmountsOut which is all we need for price quotes
ROUTER_ABI_MINIMAL = json.loads('''[
  {
    "inputs": [
      {"internalType": "uint256","name": "amountIn","type": "uint256"},
      {"internalType": "address[]","name": "path","type": "address[]"}
    ],
    "name": "getAmountsOut",
    "outputs": [
      {"internalType": "uint256[]","name": "amounts","type": "uint256[]"}
    ],
    "stateMutability": "view",
    "type": "function"
  }
]''')


# ── Price fetch ───────────────────────────────────────────────────────────────
def get_dex_price(
    w3: Web3,
    router_address: str,
    token_in: str,
    token_out: str,
    amount_in_wei: int,
    chain_name: str = "Ethereum"
) -> Optional[float]:
    """
    Gets output amount from a Uniswap-compatible DEX router.
    This is a READ-ONLY call — no gas, no transaction.
    
    Args:
        w3: Web3 instance (connected to correct chain)
        router_address: DEX router contract address
        token_in: Input token contract address
        token_out: Output token contract address
        amount_in_wei: Amount of token_in in wei
        chain_name: Label for logging
    Returns:
        Price as float (token_out per token_in), or None on failure
    """
    if not w3 or not w3.is_connected():
        print(f"[DEX] ⚠️  Not connected to {chain_name} RPC")
        return None

    try:
        router = w3.eth.contract(
            address=Web3.to_checksum_address(router_address),
            abi=ROUTER_ABI_MINIMAL
        )
        path = [
            Web3.to_checksum_address(token_in),
            Web3.to_checksum_address(token_out)
        ]
        amounts_out = router.functions.getAmountsOut(amount_in_wei, path).call()
        # amounts_out[1] is how much token_out we get for amount_in of token_in
        price = amounts_out[1] / amount_in_wei
        print(f"[DEX:{chain_name}] Price = {price:.6f} token_out per token_in")
        return price
    except Exception as e:
        print(f"[DEX:{chain_name}] Error fetching price: {e}")
        return None


def get_eth_uniswap_price(amount_eth_wei: int = 10**18) -> Optional[float]:
    """
    Gets ETH price in USDC from Uniswap V2 on Ethereum mainnet.
    Default: price of 1 ETH (1e18 wei).
    
    Returns:
        USDC price per ETH (adjusted for USDC's 6 decimals), or None
    """
    raw = get_dex_price(
        w3=w3_eth,
        router_address=UNISWAP_V2_ROUTER,
        token_in=TOKENS["WETH"],
        token_out=TOKENS["USDC"],
        amount_in_wei=amount_eth_wei,
        chain_name="Ethereum-Uniswap"
    )
    if raw is None:
        return None
    # USDC has 6 decimals, WETH has 18 — adjust
    return raw * (10**18 / 10**6)


def get_polygon_sushiswap_price(amount_matic_wei: int = 10**18) -> Optional[float]:
    """
    Gets MATIC price in USDC from Sushiswap on Polygon.
    Default: price of 1 MATIC (1e18 wei).
    
    Returns:
        USDC price per MATIC, or None
    """
    raw = get_dex_price(
        w3=w3_polygon,
        router_address=SUSHISWAP_POLY_ROUTER,
        token_in=TOKENS["WMATIC"],
        token_out=TOKENS["USDC_POLY"],
        amount_in_wei=amount_matic_wei,
        chain_name="Polygon-Sushiswap"
    )
    if raw is None:
        return None
    return raw * (10**18 / 10**6)


# ── Connectivity check ────────────────────────────────────────────────────────
def check_connections() -> dict:
    """
    Confirms both chain RPC connections are live.
    Run this on startup before any price calls.
    """
    results = {}

    if w3_eth:
        try:
            block = w3_eth.eth.block_number
            results["ethereum"] = {"connected": True, "latest_block": block}
            print(f"[DEX] Ethereum connected — block #{block}")
        except Exception as e:
            results["ethereum"] = {"connected": False, "error": str(e)}
            print(f"[DEX] Ethereum NOT connected: {e}")
    else:
        results["ethereum"] = {"connected": False, "error": "INFURA_URL not set"}

    try:
        block = w3_polygon.eth.block_number
        results["polygon"] = {"connected": True, "latest_block": block}
        print(f"[DEX] Polygon connected — block #{block}")
    except Exception as e:
        results["polygon"] = {"connected": False, "error": str(e)}
        print(f"[DEX] Polygon NOT connected: {e}")

    return results


# ── Run directly for testing ──────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "="*55)
    print("DEX PRICE FEED TEST")
    print("="*55)

    connections = check_connections()
    print(f"\nConnections: {connections}")

    if connections.get("ethereum", {}).get("connected"):
        eth_price = get_eth_uniswap_price()
        if eth_price:
            print(f"\nUniswap ETH/USDC: ${eth_price:,.2f}")

    if connections.get("polygon", {}).get("connected"):
        matic_price = get_polygon_sushiswap_price()
        if matic_price:
            print(f"Sushiswap MATIC/USDC: ${matic_price:,.4f}")

    print("="*55 + "\n")
