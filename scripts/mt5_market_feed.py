"""
scripts/mt5_market_feed.py
============================
Continuous MT5 price/candle feed, added 2026-09-26 to give the OANDA-routed
forex/commodity/index pairs a SECOND, independent data source.

Why this exists rather than a full separate MT5 trading path: MT5 is
connected here to Alan's *same* OANDA account that src/brokers/oandaBroker.js
already trades via the v20 REST API (see config/instrument_universe.json).
Running two independent traders against the same account/instrument would
double up paper positions and confuse the ledger for no benefit. Instead,
this process polls MT5 on its own schedule and writes what it sees to
data/mt5_market_data.json; src/data/oandaMarketData.js reads that file ONLY
as a fallback when the OANDA REST API itself fails to return a price/candles
for a pair - i.e. this is the self-healing backup data path, not a second
execution engine. MT5_ALLOW_LIVE stays false regardless; this script never
places an order.

Polls every MT5_FEED_INTERVAL_S seconds (default 30). Connects to MT5 once
per cycle (not once per symbol - the terminal handshake is not free) and
disconnects at the end of the cycle so the terminal is free for Alan to use
interactively between polls.
"""
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.bridge import mt5Bridge as mt5b  # noqa: E402

os.makedirs(ROOT / "logs", exist_ok=True)
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] [mt5-feed] %(message)s",
)
logger = logging.getLogger(__name__)

OUT_PATH = ROOT / "data" / "mt5_market_data.json"
INTERVAL_S = int(os.getenv("MT5_FEED_INTERVAL_S", "30"))

# OANDA pair (as used in config/instrument_universe.json) -> the equivalent
# symbol name on Alan's OANDA MT5 terminal, confirmed live via
# mt5.symbols_get() on 2026-09-26. GER40/DE30 has no confirmed MT5 symbol on
# this account, so it is intentionally left out (oandaMarketData.js simply
# gets no MT5 fallback for that one pair).
SYMBOL_MAP = {
    "EUR/USD": "EURUSD",
    "GBP/USD": "GBPUSD",
    "USD/JPY": "USDJPY",
    "AUD/USD": "AUDUSD",
    "USD/CHF": "USDCHF",
    "XAU/USD": "XAUUSD",
    "XAG/USD": "XAGUSD",
    "WTI": "USOIL",
    "BRENT": "UKOIL",
    "NATGAS": "NATGAS",
    "US500": "US500",
    "US100": "US100",
    "UK100": "UK100",
}


def _write_json(path: Path, data) -> None:
    """Atomic write, same pattern as bridge/python_to_node.py."""
    import tempfile
    content = json.dumps(data, indent=2, default=str)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(suffix=".tmp", prefix=path.stem + "_", dir=str(path.parent))
    try:
        os.write(fd, content.encode("utf-8"))
    finally:
        os.close(fd)
    os.replace(tmp_path, str(path))


def poll_once() -> dict:
    mt5, account = mt5b.connect()
    out = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "account": account.login,
        "server": account.server,
        "mode": "LIVE" if mt5b.is_live_account(account) else "DEMO",
        "symbols": {},
    }
    try:
        for pair, mt5_symbol in SYMBOL_MAP.items():
            try:
                tick = mt5.symbol_info_tick(mt5_symbol)
                if tick is None:
                    # Symbol exists on the account but isn't in Market Watch yet -
                    # MT5 won't stream ticks for it until selected. Select it once
                    # and retry; if it's still None the symbol really is unusable.
                    mt5.symbol_select(mt5_symbol, True)
                    tick = mt5.symbol_info_tick(mt5_symbol)
                if tick is None:
                    logger.warning("No tick for %s (%s) - skipping this cycle.", pair, mt5_symbol)
                    continue
                # FIX 2026-09-26: right after symbol_select() the terminal often
                # returns a tick OBJECT immediately but hasn't actually received a
                # live quote from the server yet, so bid/ask both come back as 0.0.
                # Writing that straight into the feed would hand oandaMarketData.js
                # a "valid-looking" zero price the moment OANDA's REST API stumbles
                # - which could get treated as a real price downstream. So retry a
                # few times with a short pause, and if it's still zero, skip the
                # symbol entirely this cycle rather than publish a fake price.
                retries = 0
                while (tick is None or tick.bid <= 0 or tick.ask <= 0) and retries < 5:
                    time.sleep(0.3)
                    tick = mt5.symbol_info_tick(mt5_symbol)
                    retries += 1
                if tick is None or tick.bid <= 0 or tick.ask <= 0:
                    logger.warning(
                        "%s (%s) has no live quote yet (bid/ask still 0 after %d retries) - skipping this cycle.",
                        pair, mt5_symbol, retries,
                    )
                    continue
                rates = mt5.copy_rates_from_pos(mt5_symbol, mt5.TIMEFRAME_H1, 0, 100)
                candles = [
                    {
                        "timestamp": int(r["time"]) * 1000,
                        "open": float(r["open"]), "high": float(r["high"]),
                        "low": float(r["low"]), "close": float(r["close"]),
                        "volume": float(r["tick_volume"]),
                    }
                    for r in rates
                ] if rates is not None else []
                out["symbols"][pair] = {
                    "mt5Symbol": mt5_symbol,
                    "bid": tick.bid,
                    "ask": tick.ask,
                    "mid": (tick.bid + tick.ask) / 2,
                    "candles": candles,
                }
            except Exception as exc:
                logger.warning("Failed to poll %s (%s): %s", pair, mt5_symbol, exc)
    finally:
        mt5.shutdown()
    return out


def main():
    logger.info(
        "Starting MT5 market feed (interval=%ss, %d symbols). Backup data source only - "
        "never places orders; OANDA's REST API remains the primary path.",
        INTERVAL_S, len(SYMBOL_MAP),
    )
    consecutive_failures = 0
    while True:
        try:
            data = poll_once()
            _write_json(OUT_PATH, data)
            logger.info("Wrote %d/%d symbols to %s", len(data["symbols"]), len(SYMBOL_MAP), OUT_PATH.name)
            consecutive_failures = 0
        except mt5b.MT5Error as e:
            consecutive_failures += 1
            logger.warning("MT5 poll failed (%d in a row): %s", consecutive_failures, e)
        except Exception as e:
            consecutive_failures += 1
            logger.exception("Unexpected error in MT5 feed loop (%d in a row): %s", consecutive_failures, e)
        time.sleep(INTERVAL_S)


if __name__ == "__main__":
    main()
