"""Diagnostic: compare Python ETH 2h EMA_VWAP trades against the TradingKit trade list."""
import json, sys, datetime as dt
sys.path.insert(0, r"F:\aitradingagent")
from pybacktest.data import get_candles
from pybacktest.strategies import lab_signals
from pybacktest import engine
c = get_candles("ETH", "2h", since="2020-03-25")
print("candles", len(c), "first", dt.datetime.utcfromtimestamp(c[0]["timestamp"]/1000), "last", dt.datetime.utcfromtimestamp(c[-1]["timestamp"]/1000))
gaps = [(c[i-1]["timestamp"], c[i]["timestamp"]) for i in range(1, len(c)) if c[i]["timestamp"] - c[i-1]["timestamp"] != 7200000]
print("gaps", len(gaps), gaps[:5])
s = lab_signals(c, "EMA_VWAP")
print("long signals", sum(s["long"]), "short signals", sum(s["short"]))
t = engine.run(c, s)
print("trades", len(t), "stops", sum(1 for x in t if x["reason"] == "STOP"), "flips", sum(1 for x in t if x["reason"] == "FLIP"))
for x in t[:8]:
    print(dt.datetime.utcfromtimestamp(x["entry_time"]/1000), x["side"], round(x["entry"],2), "->", dt.datetime.utcfromtimestamp(x["exit_time"]/1000), round(x["exit"],2), x["reason"], round(x["pct"],2))
