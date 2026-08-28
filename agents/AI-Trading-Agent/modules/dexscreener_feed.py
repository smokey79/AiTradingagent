import aiohttp
import asyncio
from modules.chains import CHAINS

async def fetch_token_pairs(session, token_address: str):
    url = f"https://api.dexscreener.com/latest/dex/tokens/{token_address}"
    try:
        async with session.get(url, timeout=10) as resp:
            if resp.status == 200:
                data = await resp.json()
                return data.get("pairs", [])
    except Exception as e:
        print(f"[DexScreener Error]: {e}")
    return []

async def get_multi_chain_prices(token_address: str):
    async with aiohttp.ClientSession() as session:
        pairs = await fetch_token_pairs(session, token_address)
        chain_prices = {}
        for p in pairs:
            chain_id = p.get("chainId")
            price_usd = float(p.get("priceUsd") or 0)
            liquidity = float(p.get("liquidity", {}).get("usd", 0))
            dex_id = p.get("dexId")
            
            if price_usd > 0 and liquidity > 5000:
                if chain_id not in chain_prices or liquidity > chain_prices[chain_id]["liquidity"]:
                    chain_prices[chain_id] = {
                        "chain": chain_id,
                        "dex": dex_id,
                        "price": price_usd,
                        "liquidity": liquidity,
                        "pairAddress": p.get("pairAddress")
                    }
        return chain_prices
