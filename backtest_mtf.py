"""
backtest_mtf.py
================
Multi-timeframe (15m/1h/4h), multi-token (top-50-derived universe)
backtest engine for the 2026-09-23 research request. Three strategy
families drawn from this session's GitHub/web research (freqtrade
community strategies, paulcpk/freqtrade-strategies-that-work, BinHV45-
style mean reversion):

  1. ema_trend    -- EMA-fast/slow crossover + trend filter (the same
                     family already validated for the daily/2h agents,
                     re-tested here at higher frequency)
  2. bb_meanrev   -- Bollinger Band mean-reversion (BinHV45/ClucMay-style):
                     buy when price closes below the lower band with RSI
                     oversold confirmation, exit at the middle band or stop
  3. rsi_momentum -- RSI momentum continuation (paulcpk's
                     RSIDirectionalWithTrend family): buy when RSI crosses
                     back above an oversold threshold while price is above
                     a longer trend EMA

ALL strategies charge a 0.20% round-trip cost -- the standard this project
adopted after the PDH/PDL research (2026-09-16) showed a naive gross-only
backtest can look profitable and then go 72/72 NO-GO once real costs are
included. Nothing here is reported without that cost already applied.

Vectorized (numpy arrays, not df.iloc) -- row-by-row access was proven
catastrophically slow at grid-search scale in backtest_own_ohlcv.py.
"""
import json
import os

import numpy as np
import pandas as pd

MTF_DIR = "data/ohlcv/mtf"
ROUND_TRIP_COST_PCT = 0.20  # matches this project's established cost model


def load_universe():
    with open("data/ohlcv/top50_universe.json") as f:
        return [e["symbol"] for e in json.load(f)["included"]]


def ema(values, length):
    k = 2 / (length + 1)
    out = np.empty_like(values, dtype=float)
    out[0] = values[0]
    for i in range(1, len(values)):
        out[i] = values[i] * k + out[i - 1] * (1 - k)
    return out


def rsi(closes, length=14):
    out = np.full(len(closes), 50.0)
    delta = np.diff(closes, prepend=closes[0])
    gain = np.clip(delta, 0, None)
    loss = np.clip(-delta, 0, None)
    avg_gain = avg_loss = 0.0
    for i in range(1, len(closes)):
        if i <= length:
            avg_gain = (avg_gain * (i - 1) + gain[i]) / i
            avg_loss = (avg_loss * (i - 1) + loss[i]) / i
        else:
            avg_gain = (avg_gain * (length - 1) + gain[i]) / length
            avg_loss = (avg_loss * (length - 1) + loss[i]) / length
        rs = 100.0 if avg_loss == 0 else avg_gain / avg_loss
        out[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + rs)
    return out


def atr(high, low, close, length=14):
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)))
    return ema(tr, length)


def sma(values, length):
    return pd.Series(values).rolling(length).mean().to_numpy()


def rolling_std(values, length):
    return pd.Series(values).rolling(length).std().to_numpy()


# ── Shared trade simulator (ATR/band-based stop+target, % P&L, cost applied) ─
def simulate_trades(o, h, l, c, entry_signal, stop_price, target_price,
                     cost_pct=ROUND_TRIP_COST_PCT):
    n = len(c)
    trades = []
    position = None
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
                gross_pct = (exit_price - position["entry"]) / position["entry"] * 100
                trades.append(gross_pct - cost_pct)
                position = None
        if position is None and entry_signal[i]:
            sp, tp = stop_price[i], target_price[i]
            if sp is not None and tp is not None and not np.isnan(sp) and not np.isnan(tp) and sp < o[i] < tp:
                position = {"entry": o[i], "stop": sp, "target": tp}
    if position is not None:
        gross_pct = (c[-1] - position["entry"]) / position["entry"] * 100
        trades.append(gross_pct - cost_pct)

    if not trades:
        return None
    trades = np.array(trades)
    wins = trades[trades > 0]
    losses = trades[trades <= 0]
    win_rate = len(wins) / len(trades) * 100
    gross_profit = wins.sum() if len(wins) else 0.0
    gross_loss = abs(losses.sum()) if len(losses) else 0.0
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)
    curve = np.cumsum(trades)
    running_max = np.maximum.accumulate(curve)
    max_dd = float((curve - running_max).min())
    return {
        "trades": len(trades), "win_rate": round(win_rate, 1),
        "profit_factor": round(min(profit_factor, 999.0), 2),
        "total_return_pct": round(float(curve[-1]), 1),
        "max_drawdown_pct": round(max_dd, 1),
    }


# ── Strategy 1: EMA crossover + trend, ATR stop/target ──────────────────────
def strategy_ema_trend(o, h, l, c, hh, ll, ema_fast_len, ema_slow_len, atr_mult, rr):
    ema_f = ema(c, ema_fast_len)
    ema_s = ema(c, ema_slow_len)
    atr_vals = atr(hh, ll, c, 14)
    n = len(c)
    entry = np.zeros(n, dtype=bool)
    stop = np.full(n, np.nan)
    target = np.full(n, np.nan)
    for i in range(2, n):
        crossed_up = ema_f[i - 1] > ema_s[i - 1] and ema_f[i - 2] <= ema_s[i - 2]
        if crossed_up:
            entry[i] = True
            sd = atr_mult * atr_vals[i - 1]
            stop[i] = o[i] - sd
            target[i] = o[i] + sd * rr
    return entry, stop, target


# ── Strategy 2: Bollinger Band mean-reversion (BinHV45/ClucMay-style) ───────
def strategy_bb_meanrev(o, h, l, c, hh, ll, bb_len, bb_std, rsi_oversold, atr_mult):
    mid = sma(c, bb_len)
    std = rolling_std(c, bb_len)
    lower = mid - bb_std * std
    rsi_vals = rsi(c, 14)
    atr_vals = atr(hh, ll, c, 14)
    n = len(c)
    entry = np.zeros(n, dtype=bool)
    stop = np.full(n, np.nan)
    target = np.full(n, np.nan)
    for i in range(1, n):
        if not np.isnan(lower[i - 1]) and c[i - 1] < lower[i - 1] and rsi_vals[i - 1] < rsi_oversold:
            entry[i] = True
            stop[i] = o[i] - atr_mult * atr_vals[i - 1]
            target[i] = mid[i - 1] if not np.isnan(mid[i - 1]) else o[i] + atr_mult * atr_vals[i - 1]
    return entry, stop, target


# ── Strategy 3: RSI momentum continuation (paulcpk RSIDirectionalWithTrend) ─
def strategy_rsi_momentum(o, h, l, c, hh, ll, rsi_cross_level, trend_ema_len, atr_mult, rr):
    rsi_vals = rsi(c, 14)
    trend_ema_vals = ema(c, trend_ema_len)
    atr_vals = atr(hh, ll, c, 14)
    n = len(c)
    entry = np.zeros(n, dtype=bool)
    stop = np.full(n, np.nan)
    target = np.full(n, np.nan)
    for i in range(2, n):
        crossed_up = rsi_vals[i - 2] < rsi_cross_level <= rsi_vals[i - 1]
        above_trend = c[i - 1] > trend_ema_vals[i - 1]
        if crossed_up and above_trend:
            entry[i] = True
            sd = atr_mult * atr_vals[i - 1]
            stop[i] = o[i] - sd
            target[i] = o[i] + sd * rr
    return entry, stop, target


STRATEGY_GRIDS = {
    "ema_trend": {
        "fn": strategy_ema_trend,
        "params": [
            {"ema_fast_len": ef, "ema_slow_len": es, "atr_mult": am, "rr": rr}
            for ef, es in [(9, 21), (20, 50), (50, 100)]
            for am in [1.5, 2.0]
            for rr in [1.5, 2.0]
        ],
    },
    "bb_meanrev": {
        "fn": strategy_bb_meanrev,
        "params": [
            {"bb_len": bl, "bb_std": bs, "rsi_oversold": ro, "atr_mult": am}
            for bl in [20, 30]
            for bs in [2.0, 2.5]
            for ro in [25, 30]
            for am in [1.5, 2.0]
        ],
    },
    "rsi_momentum": {
        "fn": strategy_rsi_momentum,
        "params": [
            {"rsi_cross_level": rc, "trend_ema_len": te, "atr_mult": am, "rr": 1.5}
            for rc in [25, 30, 35]
            for te in [50, 100]
            for am in [1.5, 2.0]
        ],
    },
}


def run_one(strategy_name, params, o, h, l, c, hh, ll):
    fn = STRATEGY_GRIDS[strategy_name]["fn"]
    entry, stop, target = fn(o, h, l, c, hh, ll, **params)
    return simulate_trades(o, h, l, c, entry, stop, target)


def split_cycles(n_bars, n_cycles=3):
    third = n_bars // n_cycles
    return [(i * third, (i + 1) * third if i < n_cycles - 1 else n_bars) for i in range(n_cycles)]


def _score(res):
    pf = min(res["profit_factor"], 5)
    return pf * (1 + res["total_return_pct"] / 100) / (1 + abs(res["max_drawdown_pct"]) / 100)


def cross_cycle_robust(token, tf, df, min_trades_per_cycle=8, require_all_cycles=True,
                        max_worst_drawdown_pct=20.0, min_profit_factor=1.0):
    o = df["open"].to_numpy(); h = df["high"].to_numpy(); l = df["low"].to_numpy(); c = df["close"].to_numpy()
    n = len(c)
    bounds = split_cycles(n)
    valid_cycles = [(s, e) for s, e in bounds if (e - s) >= 200]  # need enough bars to warm up EMA200/BB30 etc.

    candidates = []
    for strat_name, grid in STRATEGY_GRIDS.items():
        for params in grid["params"]:
            cycle_hits = []
            for s, e in valid_cycles:
                co, ch, cl, cc = o[s:e], h[s:e], l[s:e], c[s:e]
                res = run_one(strat_name, params, co, ch, cl, cc, ch, cl)
                if res is not None and res["trades"] >= min_trades_per_cycle and res["profit_factor"] > min_profit_factor:
                    cycle_hits.append(res)
            required = len(valid_cycles) if require_all_cycles else min(2, len(valid_cycles))
            if len(cycle_hits) < required:
                continue
            worst_dd = min(r["max_drawdown_pct"] for r in cycle_hits)
            if abs(worst_dd) > max_worst_drawdown_pct:
                continue  # a "profitable on average" combo with a 40-60% drawdown cycle is noise, not edge
            avg_score = float(sum(_score(r) for r in cycle_hits) / len(cycle_hits))
            candidates.append({
                "strategy": strat_name, "params": params,
                "cycles_present": len(cycle_hits), "cycles_valid": len(valid_cycles),
                "total_trades": int(sum(r["trades"] for r in cycle_hits)),
                "avg_score": round(avg_score, 3),
                "avg_return_pct": round(float(sum(r["total_return_pct"] for r in cycle_hits) / len(cycle_hits)), 2),
                "avg_profit_factor": round(float(sum(r["profit_factor"] for r in cycle_hits) / len(cycle_hits)), 2),
                "avg_win_rate": round(float(sum(r["win_rate"] for r in cycle_hits) / len(cycle_hits)), 1),
                "worst_cycle_drawdown_pct": round(float(min(r["max_drawdown_pct"] for r in cycle_hits)), 2),
            })
    candidates.sort(key=lambda x: x["avg_score"], reverse=True)
    return {
        "token": token, "timeframe": tf, "bars": n, "cycles_valid": len(valid_cycles),
        "candidates_found": len(candidates), "top_3": candidates[:3],
        "recommended": candidates[0] if candidates else None,
    }


if __name__ == "__main__":
    universe = load_universe()
    timeframes = ["15m", "1h", "4h"]
    all_results = {}
    for token in universe:
        for tf in timeframes:
            path = f"{MTF_DIR}/{token}_{tf}.csv"
            if not os.path.exists(path):
                print(f"{token} {tf}: no data file, skipping", flush=True)
                continue
            df = pd.read_csv(path, parse_dates=["date"])
            if len(df) < 600:
                print(f"{token} {tf}: only {len(df)} bars, too few, skipping", flush=True)
                continue
            r = cross_cycle_robust(token, tf, df)
            all_results.setdefault(tf, {})[token] = r
            if r["recommended"]:
                rec = r["recommended"]
                print(f"{token:<6} {tf:<4} ROBUST: {rec['strategy']} {rec['params']} -> "
                      f"{rec['cycles_present']}/{rec['cycles_valid']} cycles, {rec['total_trades']} trades, "
                      f"avg PF {rec['avg_profit_factor']}, avg return {rec['avg_return_pct']:+.1f}%, "
                      f"worst DD {rec['worst_cycle_drawdown_pct']}%", flush=True)
            else:
                print(f"{token:<6} {tf:<4} -- no combo cleared the robustness bar", flush=True)

    with open("data/ohlcv/mtf/cross_cycle_robust_findings_mtf.json", "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    print("\nSaved to data/ohlcv/mtf/cross_cycle_robust_findings_mtf.json", flush=True)
