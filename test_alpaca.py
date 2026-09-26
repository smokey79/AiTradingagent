r"""
test_alpaca.py - checks the Alpaca PAPER keys in .env work. Read-only: places no orders.
Run:  powershell.exe -ExecutionPolicy Bypass -File .\_run_test_alpaca.ps1
"""
import os, sys, requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
key = os.getenv("APCA_API_KEY_ID") or os.getenv("ALPACA_API_KEY", "")
secret = os.getenv("APCA_API_SECRET_KEY") or os.getenv("ALPACA_SECRET_KEY", "")
base = (os.getenv("APCA_API_BASE_URL") or os.getenv("ALPACA_BASE_URL") or "https://paper-api.alpaca.markets").rstrip("/")
base = base[:-3] if base.endswith("/v2") else base

if "paper-api" not in base:
    sys.exit("SAFETY STOP: base URL is not the PAPER endpoint. Fix ALPACA_BASE_URL in .env.")
if not key or not secret:
    sys.exit("Alpaca keys missing from .env (ALPACA_API_KEY / ALPACA_SECRET_KEY).")

print(f"Key ID: {key[:4]}...{key[-3:]} ({len(key)} chars) | Secret length: {len(secret)} chars")
r = requests.get(f"{base}/v2/account", headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret}, timeout=15)
if r.status_code != 200:
    print(f"FAILED ({r.status_code}): {r.text[:200]}")
    print("Fix: Alpaca dashboard > Paper Trading > API Keys > Regenerate, then paste BOTH new values into .env")
    sys.exit(1)
a = r.json()
print(f"OK - paper account {a.get('status')} | cash ${float(a['cash']):,.2f} | buying power ${float(a['buying_power']):,.2f} | blocked={a.get('trading_blocked')}")
