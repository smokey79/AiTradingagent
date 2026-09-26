# Multi-timeframe robustness lab (24 Sep 2026)

Follow-up to `research/btc_strategy_lab_2026-09-13`. That lab mostly tested 1h/2h/4h and
found one survivor (ETH 2h EMA50/100 + VWAP). This lab asks a different question:
**does a strategy work across coins AND neighbouring timeframes?** A single winning cell
is treated as likely luck, not an edge.

Grid: 7 coins (BTC ETH SOL AVAX ARB OP CRO) x 6 timeframes (15m 30m 1h 2h 4h 1D; TradingKit rejects 6h and 12h)
x 4 locked strategies (the 13 Sep top trend systems, no re-tuning) = 168 backtests on
TradingKit (Bybit perps, full history, 0.05% commission).

For every run the trades are pulled and split:
- in-sample = before 2024-01-01, out-of-sample (OOS) = 2024-01-01 onward
- profit factor from each trade's own % return (sizing-independent)
- realistic resimulation at 15% of equity per trade

A strategy "passes" a cell only if: >= 100 trades total, >= 30 OOS trades,
full-history pctPF >= 1.2, OOS pctPF >= 1.1, and drawdown at 15% exposure <= 25%.
It counts as ROBUST only if it passes on >= 3 coins and, on each of those coins,
on at least 2 adjacent timeframes.

## Files
- `probe.js`      checks TradingKit credits, which intervals work, and trade fields (no backtests)
- `strategies.js` the 4 locked strategies (Pine v6, same templates as 13 Sep)
- `batch.js`      builds the 224-run grid
- `run.js`        runner: resumable, saves after every run to `results.json`
- `summarize.js`  builds `SUMMARY.md` (heatmap tables + robust list)
- `RUN-LAB.ps1`   starts the run in the background and logs to `run.log`

## Run it (from F:\aitradingagent, in a VS Code terminal)
    powershell.exe -ExecutionPolicy Bypass -File research\multi_tf_lab_2026-09-24\RUN-LAB.ps1 -Probe
    powershell.exe -ExecutionPolicy Bypass -File research\multi_tf_lab_2026-09-24\RUN-LAB.ps1
    node research\multi_tf_lab_2026-09-24\summarize.js

Needs TRADINGKIT_API_KEY in F:\aitradingagent\.env (already used by src/data/tradingKitFeed.js).
Re-running skips cells already in results.json, so an interrupted run just continues.
