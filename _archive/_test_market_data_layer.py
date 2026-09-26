import sys
from pathlib import Path
sys.path.insert(0, str(Path("F:/aitradingagent")))

from data.market_data import CCXTClient, get_latest_candle, CoinGeckoClient

print("=== CCXTClient direct (Bitget) ===")
try:
    client = CCXTClient(exchange_id="bitget")
    ticker = client.get_ticker("BTC/USDT")
    print("Ticker:", ticker)
    candle = client.get_latest_candle("BTCUSDT")
    print("Candle:", candle)
except Exception as e:
    print("CCXT/Bitget FAILED:", e)

print("\n=== get_latest_candle() combined (Bitget->CoinGecko) for the 7-token universe ===")
for sym in ["BTC/USDT", "ETH/USDT", "CRO/USDT", "SOL/USDT", "AVAX/USDT", "ARB/USDT", "OP/USDT"]:
    c = get_latest_candle(sym)
    if c:
        print(f"{sym:10} close=${c.close:,.4f}  src={c.source.value}")
    else:
        print(f"{sym:10} FAILED (both sources)")

print("\n=== CoinGeckoClient direct sanity check ===")
try:
    cg = CoinGeckoClient()
    candles = cg.get_ohlc("bitcoin", days=1)
    print(f"CoinGecko BTC candles fetched: {len(candles)}")
except Exception as e:
    print("CoinGecko FAILED:", e)
