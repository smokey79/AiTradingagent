import importlib.util
for m in ["ccxt", "vectorbt", "pandas_ta", "tvDatafeed", "pycoingecko", "freqtrade"]:
    print(m, "->", "YES" if importlib.util.find_spec(m) else "no")
