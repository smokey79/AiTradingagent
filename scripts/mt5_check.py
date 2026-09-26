"""
scripts/mt5_check.py - read-only MT5 connection check. Places NO orders.
Shows account type (demo/live), balance, and a latest EURUSD candle.
Usage (from F:\\aitradingagent): venv\\Scripts\\python.exe scripts\\mt5_check.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from src.bridge import mt5Bridge as mt5b


def main():
    try:
        mt5, account = mt5b.connect()
    except mt5b.MT5Error as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    try:
        mode = "LIVE/REAL" if mt5b.is_live_account(account) else "DEMO"
        print(f"MT5 account {account.login} on {account.server} | mode: {mode}")
        print(f"Balance: {account.balance} {account.currency} | Equity: {account.equity} | Leverage: 1:{account.leverage}")
    finally:
        mt5.shutdown()

    try:
        candles = mt5b.get_candles("EURUSD", "1h", 3)
        if candles:
            last = candles[-1]
            print(f"Latest EURUSD 1h candle: close {last['close']}")
    except mt5b.MT5Error as e:
        print(f"Candle check failed: {e}")

    gate = mt5b._live_gate_status()
    passed = "PASSED" if gate.get("passed") else "not passed"
    print(f"Live gate: {passed} ({gate.get('trades', 0)}/250 trades)")


if __name__ == "__main__":
    main()
