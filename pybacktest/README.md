# pybacktest - free, keyless strategy lab

Replaces the TradingKit (trader.dev) backtests with code that runs on this computer using
free public exchange candles (Bybit perps first - the same market TradingKit used - then
Binance, then OKX). No API keys, no credits, nothing to expire. Standard-library Python only.

| File | What it does |
|---|---|
| `data.py` | downloads and caches candles in `data/ohlcv/pyb_*.csv` (only new candles are fetched on re-runs) |
| `indicators.py` | EMA, RMA, ATR, ADX, daily VWAP - same maths as TradingView's `ta.*` |
| `strategies.py` | the 4 lab strategies + `ST_AI` (SuperTrend AI flips, see `signals/supertrend_ai.py`) |
| `engine.py` | bar-by-bar simulator matching the Pine template the labs used (fills at close, flip on opposite signal, ATR stop from the next bar, 0.05% fee per side) |
| `metrics.py` | profit factor, 2024+ out-of-sample split, 15% exposure drawdown, bootstrap, pass bar |
| `run_grid.py` | coin x timeframe x strategy grid -> `results.json`, `SUMMARY.md`, optional `parity.md` |
| `tests/` | offline unit tests (`python -m unittest pybacktest.tests.test_pybacktest -v`) |

Run everything with `RUN-PYLAB.ps1` in the project root (see its header), or directly:

    python -m pybacktest.run_grid --coins ETH,ARB --tfs 1h,2h,4h
    python -m signals.supertrend_ai ETH 4h

Pass bar per cell (same as the TradingKit lab): >= 100 trades, profit factor >= 1.2,
>= 30 trades and PF >= 1.1 from 2024 on, drawdown <= 25% at 15% of equity per trade.
A strategy is ROBUST only when it passes on 3+ coins, each on 2+ neighbouring timeframes.

Differences from TradingKit to expect: exchange data vendor and exact candle values,
TradingView's warm-up handling, and fill details. `--parity` measures how far apart the
two are on the 168 cells both ran.
