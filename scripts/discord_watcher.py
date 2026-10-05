"""
discord_watcher.py - AiTradingAgent v4: automatic Discord feed (PM2 app "discord-feed")
=======================================================================================
Runs 24/7 under PM2 and posts to Discord WITHOUT any change to the trading code.
It only READS files the bot already writes - it never touches orders or ledgers.

What it posts automatically
  * Every closed trade      - new lines in data/trade_ledger.json (JSONL)
  * Signal changes          - latest_decision.json action changes (e.g. FLAT -> LONG)
  * Process alerts          - any PM2 app going stopped/errored, or crash-looping
  * Stale-bot alert         - bot data files not updated for DISCORD_STALE_MIN minutes
  * Hourly heartbeat        - balance, P&L, apps online
  * Daily summary           - at DISCORD_SUMMARY_HOUR (local time), incl. the
                              68% / 250-trade live-funds gate progress

Self-healing
  * If DISCORD_WEBHOOK_URL is not in .env yet, it waits and re-checks every
    5 minutes - add the webhook and it starts posting with no restart needed.
  * Remembers what it already posted (data/discord_watcher_state.json), so a
    restart never re-posts old trades.
  * Any error in one check is logged and posted once, the loop keeps going.

Optional .env settings (all have defaults):
  DISCORD_HEARTBEAT_MIN=60   DISCORD_SUMMARY_HOUR=21   DISCORD_STALE_MIN=90
  DISCORD_SIGNAL_CHANGES=true

Run by hand to test:   venv\\Scripts\\python.exe scripts\\discord_watcher.py --once
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import modules.discord_feed as df  # noqa: E402

DATA = ROOT / "data"
LEDGER = DATA / "trade_ledger.json"
PORTFOLIO = DATA / "portfolio_state.json"
DECISION = ROOT / "latest_decision.json"
STATE_FILE = DATA / "discord_watcher_state.json"
SELF_NAME = "discord-feed"
PM2_FALLBACK = Path(os.path.expandvars(r"%LOCALAPPDATA%\hermes\node\pm2.cmd"))

LOOP_S = 60


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def log(msg: str) -> None:
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


# ------------------------------------------------------------- state ---
def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(st: dict) -> None:
    try:
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(st, indent=1), encoding="utf-8")
        tmp.replace(STATE_FILE)
    except Exception as e:
        log(f"could not save state: {e}")


# ------------------------------------------------------------- readers ---
def read_ledger() -> list[dict]:
    rows = []
    if not LEDGER.exists():
        return rows
    text = LEDGER.read_text(encoding="utf-8", errors="ignore").strip()
    if text.startswith("["):  # tolerate a JSON-array ledger too
        try:
            return [r for r in json.loads(text) if isinstance(r, dict)]
        except Exception:
            return rows
    for line in text.splitlines():
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    return rows


def read_json(p: Path) -> dict:
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def counts_for_stats(t: dict) -> bool:
    return not (
        t.get("simulated") or t.get("isSimulated") or t.get("excludeFromLearning")
    )


def pm2_apps() -> list[dict] | None:
    exe = shutil.which("pm2") or (str(PM2_FALLBACK) if PM2_FALLBACK.exists() else None)
    if not exe:
        return None
    try:
        out = subprocess.run(
            [exe, "jlist"],
            capture_output=True,
            text=True,
            timeout=30,
            shell=exe.lower().endswith(".cmd"),
        ).stdout
        i = out.find("[")
        return json.loads(out[i:]) if i >= 0 else None
    except Exception:
        return None


# ------------------------------------------------------------- checks ---
def check_trades(feed, st: dict, first_run: bool) -> None:
    seen = set(st.get("seen_trade_ids", []))
    rows = read_ledger()
    new = [t for t in rows if t.get("id") and t["id"] not in seen]
    if first_run:  # don't flood Discord with history on first start
        seen.update(t["id"] for t in new)
        new = []
    for t in new:
        pnl = t.get("pnlPct")
        outcome = (t.get("outcome") or "").upper()
        feed.trade(
            symbol=t.get("pair") or t.get("symbol", "?"),
            side=str(t.get("side", "?")),
            price=float(t.get("exitPrice") or t.get("price") or 0),
            qty=float(t.get("amount") or 0),
            pnl_pct=float(pnl) if pnl is not None else None,
            strategy=(t.get("reason") or "")[:100],
            confidence=t.get("confidence"),
            exchange=f"{t.get('engine', '')} {t.get('leverage', '')}x".strip(),
            outcome=outcome,
        )
        seen.add(t["id"])
    st["seen_trade_ids"] = list(seen)[-5000:]


def check_signal(feed, st: dict) -> None:
    if os.getenv("DISCORD_SIGNAL_CHANGES", "true").lower() != "true":
        return
    d = read_json(DECISION)
    action = (d.get("action") or d.get("final_signal") or "").upper()
    if not action:
        return
    prev = st.get("last_action")
    st["last_action"] = action
    if prev and prev != action:
        sym = d.get("symbol", "?")
        feed.info(
            f"Signal change {sym}: {prev} → {action}",
            f"{(d.get('reason') or d.get('reasoning') or '')[:600]}\n"
            f"_source: {d.get('source', d.get('orchestrator', '?'))}_",
        )


def check_processes(feed, st: dict) -> list[dict] | None:
    apps = pm2_apps()
    if apps is None:
        return None
    prev = st.get("pm2", {})
    now = {}
    for a in apps:
        name = a.get("name")
        if name == SELF_NAME:
            continue
        env = a.get("pm2_env", {})
        status, restarts = env.get("status"), int(env.get("restart_time", 0))
        now[name] = {"status": status, "restarts": restarts}
        p = prev.get(name)
        if p and p["status"] == "online" and status in ("stopped", "errored"):
            feed.error(name, f"PM2 app '{name}' is now {status.upper()}.")
        elif p and status == "online" and p["status"] in ("stopped", "errored"):
            feed.info(f"{name} recovered", "Back online.")
        if p and restarts - p["restarts"] >= 3:
            feed.error(
                name,
                f"Crash-looping: {restarts - p['restarts']} restarts "
                f"since last check (total {restarts}).",
            )
    if prev and not now:
        feed.error(
            "pm2",
            "No trading apps are loaded in PM2 - the bot is not running.\n"
            "Start it with START-PM2-BOT.bat",
        )
    st["pm2"] = now
    return apps


def check_stale(feed, st: dict) -> None:
    limit = _int_env("DISCORD_STALE_MIN", 90) * 60
    files = [p for p in (PORTFOLIO, LEDGER, DECISION) if p.exists()]
    if not files:
        return
    newest = max(p.stat().st_mtime for p in files)
    age = time.time() - newest
    if age > limit and not st.get("stale_alerted"):
        feed.error(
            "watchdog",
            f"No bot activity for {int(age // 60)} min "
            f"(portfolio/ledger/decision files unchanged).",
        )
        st["stale_alerted"] = True
    elif age <= limit and st.get("stale_alerted"):
        feed.info("Bot activity resumed", "Data files are updating again.")
        st["stale_alerted"] = False


def heartbeat(feed, st: dict, apps) -> None:
    every = _int_env("DISCORD_HEARTBEAT_MIN", 60) * 60
    if time.time() - st.get("last_heartbeat", 0) < every:
        return
    pf = read_json(PORTFOLIO)
    online = total = 0
    if apps:
        mine = [a for a in apps if a.get("name") != SELF_NAME]
        total = len(mine)
        online = sum(1 for a in mine if a.get("pm2_env", {}).get("status") == "online")
    feed.heartbeat(
        equity=pf.get("currentBalance"),
        models_up=f"{online}/{total} PM2 apps online"
        if apps is not None
        else "pm2 n/a",
    )
    st["last_heartbeat"] = time.time()


def daily_summary(feed, st: dict, force: bool = False) -> None:
    hour = _int_env("DISCORD_SUMMARY_HOUR", 21)
    today = datetime.now().strftime("%Y-%m-%d")
    if not force and (
        datetime.now().hour < hour or st.get("last_summary_date") == today
    ):
        return
    rows = [t for t in read_ledger() if counts_for_stats(t)]

    def local_day(t: dict) -> str:
        ts = t.get("closedAt") or t.get("timestamp") or ""
        try:
            return (
                datetime.fromisoformat(ts.replace("Z", "+00:00"))
                .astimezone()
                .strftime("%Y-%m-%d")
            )
        except Exception:
            return ""

    todays = [t for t in rows if local_day(t) == today]
    wins = sum(1 for t in todays if (t.get("outcome") or "").upper() == "WIN")
    pnl = sum(float(t.get("pnlUsd") or 0) for t in todays)
    pf = read_json(PORTFOLIO)
    bal = float(pf.get("currentBalance") or 0)
    pnl_pct = (pnl / (bal - pnl) * 100) if bal - pnl else 0.0
    ranked = sorted(todays, key=lambda t: float(t.get("pnlPct") or 0))
    fmt = lambda t: f"{t.get('symbol', '?')} {float(t.get('pnlPct') or 0):+.2f}%"  # noqa: E731
    decided = [t for t in rows if (t.get("outcome") or "").upper() in ("WIN", "LOSS")]
    all_wins = sum(1 for t in decided if t["outcome"].upper() == "WIN")
    feed.daily_summary(
        trades=len(todays),
        wins=wins,
        pnl=pnl,
        pnl_pct=pnl_pct,
        best=fmt(ranked[-1]) if ranked else "",
        worst=fmt(ranked[0]) if ranked else "",
        running_win_rate=(all_wins / len(decided)) if decided else 0.0,
        running_trades=len(decided),
    )
    st["last_summary_date"] = today


# ------------------------------------------------------------- main ---
def get_feed():
    """Re-read .env so a webhook added later is picked up without a restart."""
    df._load_env()
    f = df.DiscordFeed()
    return f if f.enabled else None


def main() -> None:
    once = "--once" in sys.argv
    feed, st = None, load_state()
    first_run = "seen_trade_ids" not in st
    log("discord-feed watcher starting")
    last_env_check = 0.0
    while True:
        if feed is None and time.time() - last_env_check > 300:
            last_env_check = time.time()
            feed = get_feed()
            if feed:
                log("webhook found - Discord feed active")
                feed.info(
                    "Discord feed online",
                    "Watching trades, signals, PM2 apps and bot activity.",
                )
            else:
                log("no DISCORD_WEBHOOK_URL in .env yet - re-checking in 5 min")
        if feed:
            for name, fn in (
                ("trades", lambda: check_trades(feed, st, first_run)),
                ("signal", lambda: check_signal(feed, st)),
                ("stale", lambda: check_stale(feed, st)),
            ):
                try:
                    fn()
                except Exception:
                    log(f"{name} check failed:\n{traceback.format_exc()}")
            apps = None
            try:
                apps = check_processes(feed, st)
            except Exception:
                log(f"pm2 check failed:\n{traceback.format_exc()}")
            try:
                heartbeat(feed, st, apps)
                daily_summary(feed, st, force=once)
            except Exception:
                log(f"summary failed:\n{traceback.format_exc()}")
            first_run = False
            save_state(st)
        if once:
            if feed:
                feed.flush(15)
            log("--once finished")
            return
        time.sleep(LOOP_S)


if __name__ == "__main__":
    main()
