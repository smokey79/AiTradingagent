"""
fetch_multitimeframe_ohlcv.py
==============================
Task: "continue researching... on 15-minute candles and larger time
frames... check against the top 50 cryptocurrencies" (2026-09-23).

Pulls recent OHLCV for every token in data/ohlcv/top50_universe.json across
three NEW timeframes not yet covered by the two existing validated agents
(technical_daily = 1d, technical_lab = 2h): 15m, 1h, 4h.

Uses backward-from-now pagination (proven reliable in backtest_own_ohlcv.py
for pairs where a fixed `since` silently returns nothing) via Binance's
free public API -- no key, no quota, same approach as every other data
pull in this project.

Bar targets per timeframe (recent window, not full history -- for 15m/1h/4h
"how did this behave recently" matters more than "since listing day"):
  15m -> 8,640 bars  (~90 days)
  1h  -> 8,760 bars  (~1 year)
  4h  -> 4,380 bars  (~2 years)

Run: F:/aitradingagent/venv/Scripts/python.exe fetch_multitimeframe_ohlcv.py
"""
import json
import os
import time

import ccxt
import pandas as pd

OUT_DIR = "data/ohlcv/mtf"
os.makedirs(OUT_DIR, exist_ok=True)

TIMEFRAME_TARGET_BARS = {"15m": 8640, "1h": 8760, "4h": 4380}


def fetch_recent_backward(exchange, symbol, timeframe, target_bars):
    all_rows = []
    limit = 1000
    end_ms = exchange.milliseconds()
    seen_oldest = None
    while len(all_rows) < target_bars:
        try:
            batch = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit, params={"until": end_ms})
        except Exception:
            batch = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
        if not batch:
            break
        oldest_ts = batch[0][0]
        if seen_oldest is not None and oldest_ts >= seen_oldest:
            break
        all_rows = batch + all_rows
        seen_oldest = oldest_ts
        if len(batch) < limit:
            break
        end_ms = oldest_ts - 1
        time.sleep(exchange.rateLimit / 1000)
    return all_rows[-target_bars:] if len(all_rows) > target_bars else all_rows


def main():
    with open("data/ohlcv/top50_universe.json") as f:
        universe = json.load(f)["included"]

    binance = ccxt.binance({"enableRateLimit": True, "timeout": 15000})

    manifest = []
    for entry in universe:
        token, pair = entry["symbol"], entry["pair"]
        for tf, target in TIMEFRAME_TARGET_BARS.items():
            out_path = f"{OUT_DIR}/{token}_{tf}.csv"
            try:
                rows = fetch_recent_backward(binance, pair, tf, target)
                if not rows:
                    print(f"  {token} {tf}: 0 bars (skipped)", flush=True)
                    manifest.append({"token": token, "tf": tf, "bars": 0, "status": "empty"})
                    continue
                df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
                df["date"] = pd.to_datetime(df["ts"], unit="ms")
                df = df.drop_duplicates(subset="ts").sort_values("ts").reset_index(drop=True)
                df.to_csv(out_path, index=False)
                print(f"  {token} {tf}: {len(df)} bars, {df['date'].min()} -> {df['date'].max()}", flush=True)
                manifest.append({"token": token, "tf": tf, "bars": len(df),
                                  "start": str(df["date"].min()), "end": str(df["date"].max()),
                                  "status": "ok"})
            except Exception as e:
                print(f"  {token} {tf}: FAILED ({e})", flush=True)
                manifest.append({"token": token, "tf": tf, "bars": 0, "status": f"error: {e}"})

    with open(f"{OUT_DIR}/fetch_manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    ok = sum(1 for m in manifest if m["status"] == "ok")
    print(f"\nDone: {ok}/{len(manifest)} token-timeframe pulls succeeded.", flush=True)


if __name__ == "__main__":
    main()
