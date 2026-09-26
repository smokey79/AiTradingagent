import ccxt
for ex_id in ["bitget", "cryptocom", "binance"]:
    try:
        ex = getattr(ccxt, ex_id)({"enableRateLimit": True, "timeout": 15000})
        markets = ex.load_markets()
        matches = [m for m in markets if "CRO" in m.upper().split("/")[0]]
        print(ex_id, "->", matches[:10])
    except Exception as e:
        print(ex_id, "ERROR:", e)
