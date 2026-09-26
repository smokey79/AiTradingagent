"""
backtest_own_ohlcv.py
======================
Replaces Alpha Vantage (25 req/day free-tier cap, only let us test 3 of 7
tokens over ~3 years) with Alan's own OHLCV pull via ccxt — no third-party
quota, full available history, all 7 tokens.

Pulls full daily history from Binance public market data (no API key
needed for OHLCV) for the whole 7-token universe, saves it to
data/ohlcv/<TOKEN>_daily.csv (so future backtests never need to re-fetch),
then splits each token's history into 3 sequential cycles and runs the
same EMA/RSI/ATR grid-search backtest independently on each cycle to check
whether the winning settings hold up across different market regimes
(bull/bear/chop) rather than just one lucky window.

Run: F:/aitradingagent/venv/Scripts/python.exe backtest_own_ohlcv.py
"""
import ccxt
import pandas as pd
import numpy as np
import time
import json
import os

SYMBOLS = {
    "BTC": "BTC/USDT", "ETH": "ETH/USDT", "SOL": "SOL/USDT",
    "AVAX": "AVAX/USDT", "ARB": "ARB/USDT", "OP": "OP/USDT", "CRO": "CRO/USDT",
}
OUT_DIR = "data/ohlcv"
os.makedirs(OUT_DIR, exist_ok=True)

# ── Step 1: fetch full daily history via ccxt (own data, no quota) ─────────
def fetch_full_history(exchange, symbol, since_ms):
    """Forward pagination from since_ms. Works when the exchange honors an
    old `since` and just returns however much real history it has from
    that point (Binance behaves this way)."""
    all_rows = []
    limit = 1000
    cursor = since_ms
    while True:
        batch = exchange.fetch_ohlcv(symbol, timeframe="1d", since=cursor, limit=limit)
        if not batch:
            break
        all_rows.extend(batch)
        last_ts = batch[-1][0]
        if last_ts <= cursor:
            break
        cursor = last_ts + 86400000  # advance one day past the last candle
        if len(batch) < limit:
            break
        time.sleep(exchange.rateLimit / 1000)
    return all_rows

def fetch_full_history_backward(exchange, symbol):
    """Walk backward from 'now' using each batch's earliest timestamp as the
    next `until`/params anchor. More reliable than forward-from-2017 on
    exchanges that silently return nothing for a `since` older than the
    pair's actual listing/available-history date (seen with Bitget)."""
    all_rows = []
    limit = 1000
    end_ms = exchange.milliseconds()
    seen_oldest = None
    while True:
        try:
            batch = exchange.fetch_ohlcv(symbol, timeframe="1d", limit=limit, params={"until": end_ms})
        except Exception:
            batch = exchange.fetch_ohlcv(symbol, timeframe="1d", limit=limit)
        if not batch:
            break
        oldest_ts = batch[0][0]
        if seen_oldest is not None and oldest_ts >= seen_oldest:
            break  # not making progress further back
        all_rows = batch + all_rows
        seen_oldest = oldest_ts
        if len(batch) < limit:
            break
        end_ms = oldest_ts - 86400000
        time.sleep(exchange.rateLimit / 1000)
    return all_rows

def get_token_data(token, symbol):
    csv_path = f"{OUT_DIR}/{token}_daily.csv"
    binance = ccxt.binance({"enableRateLimit": True, "timeout": 15000})
    since = binance.parse8601("2017-01-01T00:00:00Z")
    try:
        rows = fetch_full_history(binance, symbol, since)
        if not rows:
            raise ValueError("empty result")
        source = "binance"
    except Exception as e:
        print(f"  Binance failed for {symbol} ({e}); trying Bitget (walking backward)...")
        bitget = ccxt.bitget({"enableRateLimit": True, "timeout": 15000})
        rows = fetch_full_history_backward(bitget, symbol)
        source = "bitget"
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
    df["date"] = pd.to_datetime(df["ts"], unit="ms")
    df = df.drop_duplicates(subset="date").sort_values("date").reset_index(drop=True)
    df.to_csv(csv_path, index=False)
    print(f"  {token}: {len(df)} daily bars, {df['date'].min().date()} -> {df['date'].max().date()} (source: {source})")
    return df

# ── Step 2: indicators (identical formulas to consensus-proxy-strategy.pine) ─
def add_indicators(df, ema_fast, ema_slow, rsi_len, macd_f, macd_s, macd_sig, atr_len, ext_len):
    df = df.copy()
    df["ema_fast"] = df["close"].ewm(span=ema_fast, adjust=False).mean()
    df["ema_slow"] = df["close"].ewm(span=ema_slow, adjust=False).mean()
    df["ext_ema"] = df["close"].ewm(span=ext_len, adjust=False).mean()

    delta = df["close"].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1/rsi_len, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/rsi_len, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    df["rsi"] = (100 - (100 / (1 + rs))).fillna(50)

    ema_f = df["close"].ewm(span=macd_f, adjust=False).mean()
    ema_s = df["close"].ewm(span=macd_s, adjust=False).mean()
    df["macd"] = ema_f - ema_s
    df["macd_signal"] = df["macd"].ewm(span=macd_sig, adjust=False).mean()

    prev_close = df["close"].shift(1)
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - prev_close).abs(),
        (df["low"] - prev_close).abs(),
    ], axis=1).max(axis=1)
    df["atr"] = tr.ewm(alpha=1/atr_len, adjust=False).mean()
    return df

# ── Step 3: bar-by-bar simulation (same logic as the Sep-11 backtest) ──────
def backtest(df, rsi_bull_min, rsi_overbought, ext_mult, risk_pct, atr_mult, rr_ratio,
             start_equity=10000.0, fee_pct=0.001):
    # Pull columns out as plain numpy arrays once — row-by-row .iloc access
    # on a DataFrame is ~50-100x slower than indexing numpy arrays, and this
    # loop runs for every one of the 27 grid-search combos x 3 cycles x 7 tokens.
    o = df["open"].to_numpy(); h = df["high"].to_numpy(); l = df["low"].to_numpy()
    c = df["close"].to_numpy()
    ema_fast = df["ema_fast"].to_numpy(); ema_slow = df["ema_slow"].to_numpy()
    ext_ema = df["ext_ema"].to_numpy(); rsi = df["rsi"].to_numpy()
    macd = df["macd"].to_numpy(); macd_signal = df["macd_signal"].to_numpy()
    atr = df["atr"].to_numpy()
    n = len(df)

    equity = start_equity
    position = None
    trades = []

    for i in range(1, n):
        if position is not None:
            hit_stop = l[i] <= position["stop"]
            hit_target = h[i] >= position["target"]
            exit_price = None
            if hit_stop:
                exit_price = position["stop"]
            elif hit_target:
                exit_price = position["target"]
            if exit_price is not None:
                pnl = (exit_price - position["entry"]) * position["qty"]
                fee = (position["entry"] + exit_price) * position["qty"] * fee_pct
                pnl -= fee
                equity += pnl
                trades.append(pnl)
                position = None

        if position is None:
            j = i - 1
            trend_up = ema_fast[j] > ema_slow[j] and c[j] > ema_fast[j]
            momentum_up = rsi[j] > rsi_bull_min and macd[j] > macd_signal[j]
            bull_votes = int(trend_up) + int(momentum_up)
            over_extended = c[j] > ext_ema[j] + ext_mult * atr[j]
            overbought = rsi[j] > rsi_overbought
            veto = over_extended or overbought
            long_signal = bull_votes >= 2 and not veto

            if long_signal and atr[j] > 0:
                stop_distance = atr_mult * atr[j]
                entry = o[i]
                stop = entry - stop_distance
                target = entry + stop_distance * rr_ratio
                risk_amount = equity * (risk_pct / 100.0)
                qty = risk_amount / stop_distance if stop_distance > 0 else 0
                if qty > 0:
                    position = {"entry": entry, "stop": stop, "target": target, "qty": qty}

    if position is not None:
        last_close = c[-1]
        pnl = (last_close - position["entry"]) * position["qty"]
        equity += pnl
        trades.append(pnl)

    if not trades:
        return None

    wins = [t for t in trades if t > 0]
    losses = [t for t in trades if t <= 0]
    win_rate = len(wins) / len(trades) * 100
    gross_profit = sum(wins) if wins else 0
    gross_loss = abs(sum(losses)) if losses else 0
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else 999
    total_return_pct = (equity - start_equity) / start_equity * 100
    curve = np.array([start_equity] + list(np.cumsum(trades) + start_equity))
    running_max = np.maximum.accumulate(curve)
    drawdown = (curve - running_max) / running_max * 100
    max_dd = drawdown.min()

    return {
        "trades": len(trades), "win_rate": round(win_rate, 1),
        "profit_factor": round(min(profit_factor, 999), 2),
        "total_return_pct": round(total_return_pct, 1),
        "max_drawdown_pct": round(max_dd, 1),
    }

# ── Step 4: grid search over one cycle (window) of a token's data ─────────
def grid_search(df):
    ema_pairs = [(20, 50), (50, 200), (20, 100)]
    rsi_bull_mins = [40, 45, 50]
    atr_mults = [1.5, 1.75, 2.0]
    rr_ratios = [1.5, 2.0, 2.5]
    rsi_len, macd_f, macd_s, macd_sig, atr_len, ext_len = 14, 12, 26, 9, 14, 20
    rsi_overbought, risk_pct = 70, 1.0

    results = []
    for ema_fast, ema_slow in ema_pairs:
        if len(df) < ema_slow + 30:
            continue  # not enough bars in this cycle to warm up the slow EMA
        d = add_indicators(df, ema_fast, ema_slow, rsi_len, macd_f, macd_s, macd_sig, atr_len, ext_len)
        for rsi_bull_min in rsi_bull_mins:
            for atr_mult in atr_mults:
                for rr_ratio in rr_ratios:
                    res = backtest(d, rsi_bull_min, rsi_overbought, 3.0, risk_pct, atr_mult, rr_ratio)
                    if res is None:
                        continue
                    res.update({"ema_fast": ema_fast, "ema_slow": ema_slow,
                                "rsi_bull_min": rsi_bull_min, "atr_mult": atr_mult, "rr_ratio": rr_ratio})
                    results.append(res)
    if not results:
        return None
    res_df = pd.DataFrame(results)
    reasonable = res_df[res_df["trades"] >= 8]
    pool = reasonable if not reasonable.empty else res_df
    pool = pool.copy()
    pool["score"] = pool["profit_factor"].clip(upper=5) * (1 + pool["total_return_pct"] / 100) / (1 + abs(pool["max_drawdown_pct"]) / 100)
    return pool.sort_values("score", ascending=False).iloc[0].to_dict()

# ── Step 5: split into 3 sequential cycles and backtest each independently ─
def three_cycle_backtest(token, df):
    n = len(df)
    third = n // 3
    cycles = [df.iloc[0:third].reset_index(drop=True),
              df.iloc[third:2*third].reset_index(drop=True),
              df.iloc[2*third:].reset_index(drop=True)]
    out = []
    for idx, cyc in enumerate(cycles, start=1):
        if len(cyc) < 80:  # too short to mean anything (even 20/50 EMA needs warmup+trades)
            out.append({"cycle": idx, "bars": len(cyc), "skipped": "too few bars"})
            continue
        best = grid_search(cyc)
        if best is None:
            out.append({"cycle": idx, "bars": len(cyc), "skipped": "no trades in any combo"})
            continue
        best["cycle"] = idx
        best["bars"] = len(cyc)
        best["start"] = str(cyc["date"].min().date())
        best["end"] = str(cyc["date"].max().date())
        out.append(best)
    return out

# ── Main ────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    all_findings = {}
    for token, symbol in SYMBOLS.items():
        print(f"\n=== {token} ({symbol}) ===", flush=True)
        df = get_token_data(token, symbol)
        cycles = three_cycle_backtest(token, df)
        all_findings[token] = cycles
        for c in cycles:
            if "skipped" in c:
                print(f"  Cycle {c['cycle']}: SKIPPED ({c['skipped']}, {c['bars']} bars)", flush=True)
            else:
                print(f"  Cycle {c['cycle']} ({c['start']}->{c['end']}, {c['bars']} bars): "
                      f"EMA({c['ema_fast']},{c['ema_slow']}) RSI-min {c['rsi_bull_min']} "
                      f"ATRx{c['atr_mult']} RR{c['rr_ratio']} -> {c['trades']} trades, "
                      f"{c['win_rate']}% win, PF {c['profit_factor']}, "
                      f"{c['total_return_pct']:+.1f}% return, {c['max_drawdown_pct']}% DD")

    with open("data/ohlcv/three_cycle_findings.json", "w") as f:
        json.dump(all_findings, f, indent=2, default=str)
    print("\nSaved full results to data/ohlcv/three_cycle_findings.json")
