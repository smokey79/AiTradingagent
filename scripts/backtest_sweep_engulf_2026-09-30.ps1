# Backtests the Sweep & Engulf strategy (3:1 reward:risk) on 1h, 4h and daily candles over 365 days.
# Read-only: Bitget public price data only, no orders, does not touch the running duel.
# Results: data\backtest_sweep_engulf.log and data\backtests\*.json
Set-Location F:\aitradingagent
$env:BT_STRAT = 'sweep'
$env:BT_TF = '1h,4h,1d'
$env:BT_DAYS = '365'
node scripts\backtest_3candle_2026-09-30.js *> data\backtest_sweep_engulf.log
