@'
import os
import ccxt
from dotenv import load_dotenv

env_path = r"F:\AI-Trading-Agent\.env"
load_dotenv(env_path)

api_key = os.getenv("BITGET_API_KEY")
secret = os.getenv("BITGET_SECRET_KEY")
password = os.getenv("BITGET_PASSPHRASE")

print(f"Testing Bitget Connection from: {env_path}")
print(f"API Key present: {bool(api_key)}")
print(f"Secret present:  {bool(secret)}")
print(f"Passphrase:      {password}")

bitget = ccxt.bitget({
    'apiKey': api_key,
    'secret': secret,
    'password': password,
    'enableRateLimit': True,
})

try:
    bal = bitget.fetch_balance()
    usdt = bal.get('USDT', {}).get('free', 0.0)
    print(f"\n[+] Bitget Authenticated Successfully!")
    print(f"[+] Available Spot USDT Balance: ${usdt:.2f}")
except Exception as e:
    print(f"\n[-] Bitget Auth Error: {e}")
'@ | Out-File -FilePath "F:\AI-Trading-Agent\test_bitget.py" -Encoding utf8

python F:\AI-Trading-Agent\test_bitget.py