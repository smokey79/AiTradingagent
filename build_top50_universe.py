"""
build_top50_universe.py
========================
Task: "check against the top 50 cryptocurrencies by market cap" (2026-09-23
request). Pulls the real top-50 list from CoinGecko's free public API (no
key, matches the project's existing "own data, no quota" approach), then
filters it down to what's actually tradeable and worth backtesting:

  - must exist as a real SPOT USDT pair on Binance (our free ccxt data
    source for everything else in this project)
  - excludes stablecoins (nothing to trend/momentum-trade)
  - excludes wrapped/staked/liquid-restaking duplicates of a coin already
    in the list (WBTC/cbBTC when BTC is there, WSTETH/WEETH/STETH when
    ETH is there, WBETH, etc.) -- trading the wrapper adds nothing over
    trading the underlying and just doubles compute for a correlated bet
  - excludes tokenized real-world assets (PAXG, XAUT) -- these already
    caused a dynamic-universe contamination bug in this project once
    (see catch-up notes: "DYNAMIC_UNIVERSE... flawed Binance quoteVolume
    ranking let in PAXG/tokenized-equity pairs")
  - excludes anything below a minimum 24h quote-volume floor (liquidity
    filter -- thin books on 15m bars produce backtest results that can't
    actually be executed, per this session's research pass)

Run: F:/aitradingagent/venv/Scripts/python.exe build_top50_universe.py
"""
import json
import time
import urllib.request

import ccxt

MIN_24H_QUOTE_VOLUME_USD = 5_000_000  # liquidity floor for a 15m strategy

STABLECOINS = {
    "usdt", "usdc", "dai", "tusd", "fdusd", "usde", "usds", "pyusd",
    "busd", "gusd", "frax", "lusd", "usdd", "eurc", "usd1", "rlusd",
    "usdy", "usyc", "buidl",
}

# token -> the "underlying" it duplicates; if the underlying is already in
# the top-50 list, skip the wrapper (same economic bet, wasted compute)
WRAPPER_OF = {
    "wbtc": "bitcoin", "cbbtc": "bitcoin", "btcb": "bitcoin",
    "wsteth": "ethereum", "steth": "ethereum", "weeth": "ethereum",
    "wbeth": "ethereum", "reth": "ethereum", "cbeth": "ethereum",
    "meth": "ethereum",
}

TOKENIZED_RWA = {"paxg", "xaut", "tether-gold"}


def fetch_top50():
    url = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def main():
    print("Fetching top 50 by market cap from CoinGecko (free, no key)...", flush=True)
    coins = fetch_top50()
    print(f"  Got {len(coins)} coins.", flush=True)

    binance = ccxt.binance({"enableRateLimit": True, "timeout": 15000})
    markets = binance.load_markets()
    print(f"  Binance has {len(markets)} markets loaded.", flush=True)

    tickers = None  # fetched lazily, only if needed

    results = []
    skipped = []

    for rank, c in enumerate(coins, start=1):
        cg_id = c["id"]
        symbol = c["symbol"].lower()
        name = c["name"]
        market_cap = c["market_cap"]

        if symbol in STABLECOINS:
            skipped.append((rank, name, symbol, "stablecoin"))
            continue
        if cg_id in TOKENIZED_RWA or symbol in TOKENIZED_RWA:
            skipped.append((rank, name, symbol, "tokenized RWA (not a crypto-native trend bet)"))
            continue
        if symbol in WRAPPER_OF:
            underlying_id = WRAPPER_OF[symbol]
            if any(x["id"] == underlying_id for x in coins):
                skipped.append((rank, name, symbol, f"wrapper/derivative of {underlying_id} (already in list)"))
                continue

        pair = f"{symbol.upper()}/USDT"
        if pair not in markets:
            skipped.append((rank, name, symbol, f"no {pair} spot market on Binance"))
            continue

        results.append({
            "rank": rank, "id": cg_id, "name": name, "symbol": symbol.upper(),
            "pair": pair, "market_cap_usd": market_cap,
        })

    print(f"\n{len(results)} candidates pass stablecoin/RWA/wrapper/listing filters.", flush=True)
    print("Fetching 24h ticker volume for liquidity filter (batched)...", flush=True)

    final = []
    for r in results:
        try:
            t = binance.fetch_ticker(r["pair"])
            qv = t.get("quoteVolume") or 0
            r["quote_volume_24h_usd"] = qv
            if qv >= MIN_24H_QUOTE_VOLUME_USD:
                final.append(r)
            else:
                skipped.append((r["rank"], r["name"], r["symbol"].lower(),
                                 f"24h volume ${qv:,.0f} below ${MIN_24H_QUOTE_VOLUME_USD:,.0f} floor"))
            time.sleep(binance.rateLimit / 1000)
        except Exception as e:
            skipped.append((r["rank"], r["name"], r["symbol"].lower(), f"ticker fetch failed: {e}"))

    final.sort(key=lambda x: x["rank"])
    print(f"\n{len(final)} tokens pass ALL filters (liquid, tradeable, non-duplicate):", flush=True)
    for r in final:
        print(f"  #{r['rank']:>2} {r['symbol']:<8} {r['pair']:<12} 24h vol ${r['quote_volume_24h_usd']:,.0f}", flush=True)

    print(f"\n{len(skipped)} excluded:", flush=True)
    for rank, name, symbol, reason in skipped:
        print(f"  #{rank:>2} {name:<20} ({symbol}) -- {reason}", flush=True)

    with open("data/ohlcv/top50_universe.json", "w") as f:
        json.dump({"included": final, "excluded": [
            {"rank": r, "name": n, "symbol": s, "reason": reason} for r, n, s, reason in skipped
        ]}, f, indent=2)
    print("\nSaved to data/ohlcv/top50_universe.json", flush=True)


if __name__ == "__main__":
    main()
