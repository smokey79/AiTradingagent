import os
import ccxt

class FiatOnboardingGateway:
    """Routes GBP Faster Payments / Card deposits via Bitget & Crypto.com."""
    def __init__(self):
        self.bitget = ccxt.bitget({
            'apiKey': os.getenv("BITGET_API_KEY", ""),
            'secret': os.getenv("BITGET_SECRET_KEY", ""),
            'password': os.getenv("BITGET_PASSPHRASE", ""),
        })
        self.cryptocom = ccxt.cryptocom({
            'apiKey': os.getenv("CRYPTOCOM_API_KEY", ""),
            'secret': os.getenv("CRYPTOCOM_SECRET_KEY", ""),
        })

    def get_fiat_balances(self):
        balances = {"GBP": 0.0, "USDT": 0.0}
        try:
            bg_bal = self.bitget.fetch_balance()
            balances["USDT"] += bg_bal.get("USDT", {}).get("free", 0.0)
        except Exception as e:
            print(f"[Bitget Balance Fetch Skipped/Error]: {e}")
        return balances

    def execute_paper_transfer(self, source: str, target: str, amount_gbp: float):
        print(f"[Paper Trade] Routing £{amount_gbp} from {source} -> Convert GBP/USDT -> Deposit into {target}")
        return {"status": "success", "amount_gbp": amount_gbp, "mode": "PAPER_TRADE"}
