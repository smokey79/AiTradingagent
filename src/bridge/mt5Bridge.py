"""
src/bridge/mt5Bridge.py
========================
MetaTrader5 connector, in Python (the MetaTrader5 package only works on
Windows, talking to a locally-running MT5 terminal over a named pipe - there
is no equivalent Node.js library, which is why this is Python and everything
else broker-side in this project is JavaScript). Added 2026-09-26.

Alan already has "OANDA MetaTrader 5 Terminal" installed
(C:\\Program Files\\OANDA MetaTrader 5 Terminal\\terminal64.exe) - this
connects to that, or any other MT5 terminal, via login credentials.

Environment (.env, never hard-coded; set with scripts\\Set-EnvValue.ps1):
    MT5_LOGIN       required - your MT5 account number
    MT5_PASSWORD    required - your MT5 account password (NOT your OANDA
                    web login - MT5 has its own separate password, shown
                    when the account was created)
    MT5_SERVER      required - the broker server name, e.g. "OANDA-Demo-1"
                    (visible in the terminal under File > Open an Account,
                    or Tools > Options > Server)
    MT5_TERMINAL_PATH   optional - defaults to the OANDA MT5 terminal path
                        above if not set

Safety rules enforced here, on top of the risk gate:
  - initialize() reads the account's own trade_mode from the terminal and
    refuses to place ANY order if it reports a LIVE/real account unless
    MT5_ALLOW_LIVE=true is set - the terminal itself is authoritative about
    demo vs live, not a flag someone could forget to check;
  - every order must carry a stop loss (sl), or it is refused;
  - live orders additionally need the live-funds gate (68% win rate over
    the last 250 real trades) - checked via data/trade_ledger.json, the
    same file src/risk/tradeLedger.js reads/writes, so both languages agree
    on one gate.

NOT wired into the live trading cycle yet. Built and tested standalone
(with a mocked MetaTrader5 module - see tests/test_mt5_bridge.py) per
Alan's request. Run scripts/mt5_check.py once MT5_LOGIN/PASSWORD/SERVER are
set and the terminal has been opened at least once, to verify the
connection before anything else uses this module.
"""
import os
import json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

DEFAULT_TERMINAL_PATH = r"C:\Program Files\OANDA MetaTrader 5 Terminal\terminal64.exe"
LEDGER_PATH = Path(__file__).resolve().parents[2] / "data" / "trade_ledger.json"

# mt5.ACCOUNT_TRADE_MODE_DEMO == 0, ..._CONTEST == 1, ..._REAL == 2
TRADE_MODE_REAL = 2


class MT5Error(Exception):
    pass


def _mt5():
    """Imported lazily so this module can be unit-tested on non-Windows
    machines / without a running terminal by monkey-patching this function."""
    import MetaTrader5 as mt5
    return mt5


def connect():
    """Initializes the terminal connection and logs in. Returns the mt5 module
    handle (so callers can use mt5.TIMEFRAME_* constants) plus account_info().
    Raises MT5Error with a plain-English reason on any failure.
    """
    mt5 = _mt5()
    login = os.getenv("MT5_LOGIN")
    password = os.getenv("MT5_PASSWORD")
    server = os.getenv("MT5_SERVER")
    terminal_path = os.getenv("MT5_TERMINAL_PATH", DEFAULT_TERMINAL_PATH)

    if not login or not password or not server:
        raise MT5Error(
            "MT5_LOGIN / MT5_PASSWORD / MT5_SERVER missing from .env. "
            "Open your MT5 terminal once, check File > Open an Account (or "
            "your account statement) for these three values, then set them "
            "with scripts\\Set-EnvValue.ps1."
        )

    ok = mt5.initialize(path=terminal_path, login=int(login), password=password, server=server)
    if not ok:
        err = mt5.last_error()
        raise MT5Error(f"MT5 initialize() failed: {err}. Is the terminal installed at {terminal_path} and closed (not already open with a different login)?")

    info = mt5.account_info()
    if info is None:
        mt5.shutdown()
        raise MT5Error("MT5 connected but account_info() returned nothing - login likely rejected.")

    return mt5, info


def is_live_account(account_info) -> bool:
    return int(getattr(account_info, "trade_mode", 0)) == TRADE_MODE_REAL


def get_candles(symbol: str, timeframe: str = "1h", count: int = 200):
    """Candles in the lab's shape: {timestamp(ms), open, high, low, close, volume, source}."""
    mt5, _ = connect()
    tf_map = {
        "1m": mt5.TIMEFRAME_M1, "5m": mt5.TIMEFRAME_M5, "15m": mt5.TIMEFRAME_M15,
        "30m": mt5.TIMEFRAME_M30, "1h": mt5.TIMEFRAME_H1, "4h": mt5.TIMEFRAME_H4,
        "1d": mt5.TIMEFRAME_D1,
    }
    tf = tf_map.get(timeframe)
    if tf is None:
        raise MT5Error(f"Unsupported timeframe {timeframe}")
    rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
    mt5.shutdown()
    if rates is None:
        raise MT5Error(f"No candles returned for {symbol} - check the symbol is in Market Watch in the terminal.")
    return [
        {
            "timestamp": int(r["time"]) * 1000,
            "open": float(r["open"]), "high": float(r["high"]),
            "low": float(r["low"]), "close": float(r["close"]),
            "volume": float(r["tick_volume"]), "source": "mt5",
        }
        for r in rates
    ]


def get_price(symbol: str):
    mt5, _ = connect()
    tick = mt5.symbol_info_tick(symbol)
    mt5.shutdown()
    if tick is None:
        raise MT5Error(f"No tick data for {symbol} - check the symbol is in Market Watch in the terminal.")
    return {"symbol": symbol, "bid": tick.bid, "ask": tick.ask, "mid": (tick.bid + tick.ask) / 2}


def _live_gate_status():
    try:
        records = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
        real = [r for r in records if not r.get("paper")]
        recent = real[-250:]
        wins = sum(1 for r in recent if (r.get("pnlUsd") or 0) > 0)
        win_rate = wins / len(recent) if recent else 0
        return {"passed": len(recent) >= 250 and win_rate >= 0.68, "trades": len(recent), "winRate": round(win_rate, 3)}
    except Exception as e:
        return {"passed": False, "error": str(e)}


def place_market_order(symbol: str, side: str, volume: float, sl_price: float, tp_price: float = None, dry_run: bool = False):
    """Market order with a mandatory stop loss. side: 'BUY' | 'SELL'.
    Demo account: allowed. Live account (trade_mode REAL): only with
    MT5_ALLOW_LIVE=true AND the live gate passed (same 68%/250-trade rule
    as every other broker in this project).
    """
    side = side.upper()
    if side not in ("BUY", "SELL"):
        raise MT5Error("side must be BUY or SELL")
    if not sl_price or sl_price <= 0:
        raise MT5Error("Every MT5 order needs sl_price (stop loss) - refused.")

    mt5, account = connect()
    try:
        if is_live_account(account):
            if os.getenv("MT5_ALLOW_LIVE", "false").lower() != "true":
                raise MT5Error("This MT5 account reports as LIVE/real and MT5_ALLOW_LIVE is not 'true' - order blocked.")
            gate = _live_gate_status()
            if not gate.get("passed"):
                raise MT5Error(f"Live gate not passed ({gate.get('trades', 0)}/250 trades, win rate {gate.get('winRate', 'n/a')}). Order blocked.")

        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            raise MT5Error(f"No tick data for {symbol}")
        price = tick.ask if side == "BUY" else tick.bid
        if side == "BUY" and sl_price >= price:
            raise MT5Error(f"Stop {sl_price} is on the wrong side of the entry {price}")
        if side == "SELL" and sl_price <= price:
            raise MT5Error(f"Stop {sl_price} is on the wrong side of the entry {price}")

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": float(volume),
            "type": mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL,
            "price": price,
            "sl": float(sl_price),
            "deviation": 20,
            "type_filling": mt5.ORDER_FILLING_FOK,
        }
        if tp_price:
            request["tp"] = float(tp_price)

        check = {"account_login": account.login, "is_live": is_live_account(account), "symbol": symbol, "side": side, "price": price}
        if dry_run:
            return {"dryRun": True, **check, "request": request}

        result = mt5.order_send(request)
        if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
            raise MT5Error(f"order_send failed: retcode={getattr(result, 'retcode', 'none')} comment={getattr(result, 'comment', '')}")
        return {**check, "order": result._asdict()}
    finally:
        mt5.shutdown()


__all__ = ["connect", "is_live_account", "get_candles", "get_price", "place_market_order", "MT5Error"]
