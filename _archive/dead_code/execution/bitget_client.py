
import os
import ccxt
from dotenv import load_dotenv

load_dotenv()

# FIX 2026-09-13: this file is still dead_code / not wired into anything live
# (paper-trading only — no order execution is called from the running bot).
# Fixed two latent bugs while touching Bitget-related code this session:
#   - missing `import os` (BITGET_API_KEY/SECRET_KEY lookups would NameError
#     the moment this class was ever instantiated)
#   - a hard-coded fallback passphrase, which violates this project's own
#     "no hard-coded secrets or credentials in code" rule in CLAUDE.md.
# BITGET_PASSPHRASE must now be set in .env; there is no default.
class BitgetTrader:
    def __init__(self):
        self.api_key = os.getenv("BITGET_API_KEY")
        self.secret_key = os.getenv("BITGET_SECRET_KEY")
        self.passphrase = os.getenv("BITGET_PASSPHRASE")
        if not (self.api_key and self.secret_key and self.passphrase):
            raise ValueError(
                "BitgetTrader requires BITGET_API_KEY, BITGET_SECRET_KEY and "
                "BITGET_PASSPHRASE to all be set in .env — none are hard-coded."
            )
        
        self.client = ccxt.bitget({
            'apiKey': self.api_key,
            'secret': self.secret_key,
            'password': self.passphrase,
            'enableRateLimit': True,
            'options': {
                'defaultType': 'spot', # Change to 'swap' for USDT-M Futures
            }
        })

    def fetch_balance_usdt(self) -> float:
        """Fetches total available USDT balance on Bitget."""
        try:
            balance = self.client.fetch_balance()
            return float(balance.get('USDT', {}).get('free', 0.0))
        except Exception as e:
            print(f"[Bitget Auth Error]: {e}")
            return 0.0

    def execute_market_order(self, symbol: str, side: str, amount: float):
        """
        Executes a signed Spot Market Order on Bitget.
        side: 'buy' or 'sell'
        """
        try:
            print(f"[Bitget Execution] Placing {side.upper()} order for {amount} {symbol}...")
            order = self.client.create_market_order(
                symbol=symbol,
                side=side.lower(),
                amount=amount
            )
            print(f"[Bitget Success] Order ID: {order.get('id')}")
            return order
        except Exception as e:
            print(f"[Bitget Order Failed]: {e}")
            return None

if __name__ == "__main__":
    trader = BitgetTrader()
    print("Testing Bitget Authenticated Connection...")
    usdt = trader.fetch_balance_usdt()
    print(f"Available Spot USDT Balance: ${usdt:.2f}")