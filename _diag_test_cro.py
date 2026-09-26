from backtest_own_ohlcv import get_token_data, three_cycle_backtest
df = get_token_data("CRO", "CRO/USDT")
cycles = three_cycle_backtest("CRO", df)
for c in cycles:
    print(c)
