"""
pybacktest/data.py
==================
Free historical candles with no API key, cached to CSV so each candle is only
downloaded once.

Sources, in order (first that works is used, and the cache records which):
  1. Bybit linear perpetuals  - same market the TradingKit backtests used
  2. Binance spot             - deepest free history for most coins
  3. OKX spot                 - fallback (e.g. CRO)
Timeframes: 15m 30m 1h 2h 4h 6h 12h 1d (all three exchanges support these).

Cache: data/ohlcv/pyb_<source>_<COIN>_<tf>.csv  (timestamp,open,high,low,close,volume)
Re-running only fetches candles newer than the cache.

Standard library only.
"""
from __future__ import annotations

import csv
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / "data" / "ohlcv"
TF_MS = {"15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000,
         "6h": 21_600_000, "12h": 43_200_000, "1d": 86_400_000}
BYBIT_TF = {"15m": "15", "30m": "30", "1h": "60", "2h": "120", "4h": "240", "6h": "360", "12h": "720", "1d": "D"}
BINANCE_TF = {k: k for k in TF_MS}
OKX_TF = {"15m": "15m", "30m": "30m", "1h": "1H", "2h": "2H", "4h": "4H", "6h": "6Hutc", "12h": "12Hutc", "1d": "1Dutc"}
UA = {"User-Agent": "aitradingagent-pybacktest/1.0"}


def _get(url: str, params: Dict) -> dict:
    full = url + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(full, headers=UA), timeout=30) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (418, 429, 500, 502, 503) and attempt < 3:
                time.sleep(2 * (attempt + 1))
                continue
            raise
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError("unreachable")


def _row(ts, o, h, l, c, v):
    return {"timestamp": int(ts), "open": float(o), "high": float(h), "low": float(l), "close": float(c), "volume": float(v)}


def _fetch_bybit(coin: str, tf: str, start_ms: int, end_ms: int) -> List[dict]:
    out, end = [], end_ms
    while end > start_ms:
        j = _get("https://api.bybit.com/v5/market/kline", {"category": "linear", "symbol": f"{coin}USDT",
                 "interval": BYBIT_TF[tf], "start": start_ms, "end": end, "limit": 1000})
        if j.get("retCode") != 0:
            raise RuntimeError(f"Bybit: {j.get('retMsg')}")
        rows = j["result"]["list"]  # newest first
        if not rows:
            break
        out.extend(_row(*r[:6]) for r in rows)
        oldest = int(rows[-1][0])
        if oldest <= start_ms or len(rows) < 2:
            break
        end = oldest - 1
        time.sleep(0.12)
    return out


def _fetch_binance(coin: str, tf: str, start_ms: int, end_ms: int) -> List[dict]:
    out, start = [], start_ms
    while start < end_ms:
        rows = _get("https://api.binance.com/api/v3/klines", {"symbol": f"{coin}USDT", "interval": BINANCE_TF[tf],
                    "startTime": start, "endTime": end_ms, "limit": 1000})
        if not rows:
            break
        out.extend(_row(*r[:6]) for r in rows)
        last = int(rows[-1][0])
        if last <= start:
            break
        start = last + 1
        time.sleep(0.12)
    return out


def _fetch_okx(coin: str, tf: str, start_ms: int, end_ms: int) -> List[dict]:
    out, after = [], end_ms
    while True:
        j = _get("https://www.okx.com/api/v5/market/history-candles", {"instId": f"{coin}-USDT", "bar": OKX_TF[tf],
                 "after": after, "limit": 100})
        if j.get("code") != "0":
            raise RuntimeError(f"OKX: {j.get('msg')}")
        rows = j["data"]  # newest first
        if not rows:
            break
        out.extend(_row(*r[:6]) for r in rows)
        oldest = int(rows[-1][0])
        if oldest <= start_ms:
            break
        after = oldest
        time.sleep(0.12)
    return out


SOURCES = [("bybit", _fetch_bybit), ("binance", _fetch_binance), ("okx", _fetch_okx)]


def _cache_path(source: str, coin: str, tf: str) -> Path:
    return CACHE_DIR / f"pyb_{source}_{coin}_{tf}.csv"


def _read_cache(p: Path) -> List[dict]:
    if not p.exists():
        return []
    with p.open(newline="") as f:
        return [_row(r["timestamp"], r["open"], r["high"], r["low"], r["close"], r["volume"]) for r in csv.DictReader(f)]


def _write_cache(p: Path, rows: List[dict]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    with tmp.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["timestamp", "open", "high", "low", "close", "volume"])
        w.writeheader()
        w.writerows(rows)
    tmp.replace(p)


def to_ms(d) -> int:
    if isinstance(d, (int, float)):
        return int(d)
    return int(datetime.fromisoformat(str(d)).replace(tzinfo=timezone.utc).timestamp() * 1000)


def get_candles(coin: str, tf: str, since="2020-03-25", source: Optional[str] = None,
                closed_only: bool = True, verbose: bool = False) -> List[dict]:
    """Candles oldest-first from `since` to now. Uses the cache, fetching only what is missing.
    `source` forces one exchange ('bybit' | 'binance' | 'okx'); default tries them in order."""
    coin, start_ms, now = coin.upper(), to_ms(since), int(time.time() * 1000)
    order = [s for s in SOURCES if source in (None, s[0])]
    errors = []
    for name, fn in order:
        p = _cache_path(name, coin, tf)
        cached = _read_cache(p)
        fetched = False
        try:
            meta = p.with_suffix(".meta.json")
            covered_from = json.loads(meta.read_text()).get("since_ms") if meta.exists() else None
            if cached and (cached[0]["timestamp"] <= start_ms + TF_MS[tf] or (covered_from is not None and covered_from <= start_ms)):
                new = fn(coin, tf, cached[-1]["timestamp"] + 1, now)
                rows = cached + new
                fetched = True
            else:
                rows = fn(coin, tf, start_ms, now) + cached
            fetched = True
        except Exception as e:  # network / symbol not listed
            errors.append(f"{name}: {e}")
            if cached:
                rows = cached
            else:
                continue
        dedup = {r["timestamp"]: r for r in rows}
        rows = [dedup[k] for k in sorted(dedup)]
        if not rows:
            errors.append(f"{name}: no data")
            continue
        _write_cache(p, rows)
        if fetched:  # remember how far back we asked, so young coins (e.g. ARB) are not re-downloaded
            meta = p.with_suffix(".meta.json")
            prev = json.loads(meta.read_text()).get("since_ms") if meta.exists() else None
            meta.write_text(json.dumps({"since_ms": min(start_ms, prev) if prev is not None else start_ms}))
        rows = [r for r in rows if r["timestamp"] >= start_ms]
        if closed_only:
            rows = [r for r in rows if r["timestamp"] + TF_MS[tf] <= now]
        if verbose:
            print(f"  {coin} {tf}: {len(rows)} candles from {name}")
        for r in rows:
            r["source"] = name
        return rows
    raise RuntimeError(f"No candles for {coin} {tf}: " + "; ".join(errors))
