import axios from "axios";

export async function getDexPrice(tokenAddress, chainId = "ethereum") {
  const url = https://api.dexscreener.com/latest/dex/tokens//;
  const { data } = await axios.get(url, { timeout: 5000 });

  if (!data?.pairs?.length) return null;

  const best = data.pairs
    .filter(p => p.priceUsd && p.liquidity?.usd > 1000)
    .sort((a, b) => (b.liquidity.usd - a.liquidity.usd))[0];

  return {
    priceUsd: Number(best.priceUsd),
    liquidityUsd: best.liquidity.usd,
    dex: best.dexId,
    url: best.url
  };
}
