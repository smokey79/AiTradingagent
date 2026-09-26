from backtest_own_ohlcv import get_token_data
df = get_token_data("BTC", "BTC/USDT")
print(df.tail(3))
