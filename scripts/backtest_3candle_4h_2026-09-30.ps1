# Runs the 3-candle strategy backtest on 4-hour candles over 365 days (more history = more trades to judge).
# Read-only: uses Bitget public price data, places no orders, does not touch the running duel.
Set-Location F:\aitradingagent
$env:BT_TF = '4h'
$env:BT_DAYS = '365'
node scripts\backtest_3candle_2026-09-30.js *> data\backtest_3candle_4h.log
