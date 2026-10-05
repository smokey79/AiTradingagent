"""
discord_feed.py - AiTradingAgent v4 Discord feed
=================================================
Posts trades, consensus votes, risk-gate vetoes, errors, heartbeats and
daily summaries to Discord channels via webhooks.

Where it lives:   F:\\aitradingagent\\modules\\discord_feed.py
Secrets:          .env only (never hard-coded). Keys used:
    DISCORD_WEBHOOK_URL       default channel (required)
    DISCORD_WEBHOOK_TRADES    optional - fills / closes
    DISCORD_WEBHOOK_SIGNALS   optional - agent consensus votes
    DISCORD_WEBHOOK_ALERTS    optional - risk vetoes, errors, heartbeats
    DISCORD_WEBHOOK_SUMMARY   optional - daily P&L summary
    TRADING_MODE              paper | live  (shown on every message)

Design:
  * Non-blocking: messages go on a queue; a background thread sends them,
    so a slow Discord never delays a trade.
  * Rate-limit aware: honours Discord 429 retry_after.
  * Self-healing: if Discord is down, messages are buffered to
    logs/discord_backlog.jsonl and replayed automatically next start.
  * Standard library only (no pip install needed). python-dotenv is used
    if present, otherwise a tiny built-in .env reader is used.

Quick use from any module:
    from modules.discord_feed import feed
    feed.trade(symbol="BTC/USDT", side="buy", price=64250.5, qty=0.01,
               pnl_pct=None, strategy="ORB", confidence=0.74)
"""

from __future__ import annotations

import json
import os
import queue
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------- config ---
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKLOG_FILE = PROJECT_ROOT / "logs" / "discord_backlog.jsonl"
ENV_CANDIDATES = [
    PROJECT_ROOT / ".env",
    PROJECT_ROOT / "config" / "master.env",
    Path(r"C:\Users\AlanJ\projects\AiTradingagent\.env"),
]

COLOURS = {
    "buy": 0x2ECC71,      # green
    "sell": 0xE74C3C,     # red
    "signal": 0x3498DB,   # blue
    "veto": 0xE67E22,     # orange
    "error": 0x992D22,    # dark red
    "info": 0x95A5A6,     # grey
    "summary": 0x9B59B6,  # purple
}


def _load_env() -> None:
    """Load .env without overwriting variables already set in the OS."""
    try:
        from dotenv import load_dotenv  # type: ignore
        for p in ENV_CANDIDATES:
            if p.exists():
                load_dotenv(p, override=False)
        return
    except ImportError:
        pass
    for p in ENV_CANDIDATES:
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()


# ------------------------------------------------------------------ feed ---
class DiscordFeed:
    def __init__(self) -> None:
        default = os.getenv("DISCORD_WEBHOOK_URL", "").strip()
        self.hooks = {
            "trades": os.getenv("DISCORD_WEBHOOK_TRADES", "").strip() or default,
            "signals": os.getenv("DISCORD_WEBHOOK_SIGNALS", "").strip() or default,
            "alerts": os.getenv("DISCORD_WEBHOOK_ALERTS", "").strip() or default,
            "summary": os.getenv("DISCORD_WEBHOOK_SUMMARY", "").strip() or default,
        }
        self.mode = os.getenv("TRADING_MODE", "paper").strip().upper()
        self.enabled = bool(default) or any(self.hooks.values())
        self._q: queue.Queue = queue.Queue(maxsize=1000)
        self._stop = threading.Event()
        if self.enabled:
            self._replay_backlog()
            threading.Thread(target=self._worker, daemon=True,
                             name="discord-feed").start()
        else:
            print("[discord_feed] DISCORD_WEBHOOK_URL not set - feed disabled.")

    # ------------------------------------------------------ public API ---
    def trade(self, symbol: str, side: str, price: float, qty: float,
              pnl_pct: float | None = None, strategy: str = "",
              confidence: float | None = None, exchange: str = "",
              outcome: str = "") -> None:
        side_l = side.lower()
        outcome = (outcome or "").upper()
        fields = [
            ("Price", f"{price:,.6g}"), ("Qty", f"{qty:,.6g}"),
            ("Value", f"{price * qty:,.2f}"),
        ]
        if pnl_pct is not None:
            fields.append(("P&L", f"{pnl_pct:+.2f}%"))
        if confidence is not None:
            fields.append(("Confidence", f"{confidence:.0%}"))
        if strategy:
            fields.append(("Strategy", strategy))
        if exchange:
            fields.append(("Exchange", exchange))
        if outcome in ("WIN", "LOSS"):
            icon = "✅" if outcome == "WIN" else "❌"
            colour = COLOURS["buy"] if outcome == "WIN" else COLOURS["sell"]
            title = f"{icon} {outcome} · {side.upper()} {symbol} (closed)"
        else:
            icon = "🟢" if side_l == "buy" else "🔴"
            colour = COLOURS.get(side_l, COLOURS["info"])
            title = f"{icon} {side.upper()} {symbol}"
        self._post("trades", title, colour, fields)

    def consensus(self, symbol: str, decision: str, votes: dict,
                  threshold: str = "4/6") -> None:
        """votes = {"claude": {"signal":"buy","confidence":0.8,"reason":"..."}, ...}"""
        lines = []
        for agent, v in votes.items():
            sig = (v.get("signal") or "?").upper()
            conf = v.get("confidence")
            conf_s = f" {conf:.0%}" if isinstance(conf, (int, float)) else ""
            reason = (v.get("reason") or "")[:80]
            lines.append(f"**{agent}**: {sig}{conf_s} — {reason}")
        self._post("signals", f"🧠 Consensus {symbol}: {decision.upper()}",
                   COLOURS["signal"], [("Threshold", threshold)],
                   description="\n".join(lines)[:4000])

    def veto(self, symbol: str, reason: str, rule: str = "") -> None:
        fields = [("Rule", rule)] if rule else []
        self._post("alerts", f"🛑 Risk Gate VETO {symbol}", COLOURS["veto"],
                   fields, description=reason[:4000])

    def error(self, component: str, message: str) -> None:
        self._post("alerts", f"⚠️ Error in {component}", COLOURS["error"],
                   [], description=f"```{message[:3900]}```")

    def info(self, title: str, message: str = "") -> None:
        self._post("alerts", f"ℹ️ {title}", COLOURS["info"], [],
                   description=message[:4000])

    def heartbeat(self, open_trades: int | None = None, equity: float | None = None,
                  models_up: str = "") -> None:
        fields = []
        if open_trades is not None:
            fields.append(("Open trades", str(open_trades)))
        if equity is not None:
            fields.append(("Equity", f"{equity:,.2f}"))
        if models_up:
            fields.append(("Models up", models_up))
        self._post("alerts", "💓 Bot alive", COLOURS["info"], fields)

    def daily_summary(self, trades: int, wins: int, pnl: float,
                      pnl_pct: float, best: str = "", worst: str = "",
                      running_win_rate: float | None = None,
                      running_trades: int | None = None) -> None:
        wr = (wins / trades) if trades else 0.0
        fields = [
            ("Trades", str(trades)), ("Win rate", f"{wr:.0%}"),
            ("P&L", f"{pnl:+,.2f} ({pnl_pct:+.2f}%)"),
        ]
        if best:
            fields.append(("Best", best))
        if worst:
            fields.append(("Worst", worst))
        if running_win_rate is not None and running_trades is not None:
            gate = "✅ passed" if (running_win_rate >= 0.68 and
                                   running_trades >= 250) else "⏳ not yet"
            fields.append(("Live gate (68% / 250)",
                           f"{running_win_rate:.1%} over {running_trades} — {gate}"))
        self._post("summary", "📊 Daily summary", COLOURS["summary"], fields)

    def flush(self, timeout: float = 10.0) -> None:
        """Wait until queued messages are sent (call before shutdown)."""
        end = time.time() + timeout
        while not self._q.empty() and time.time() < end:
            time.sleep(0.2)

    # ------------------------------------------------------- internals ---
    def _post(self, channel: str, title: str, colour: int,
              fields: list, description: str = "") -> None:
        if not self.enabled:
            return
        url = self.hooks.get(channel)
        if not url:
            return
        embed = {
            "title": f"[{self.mode}] {title}"[:256],
            "color": colour,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "fields": [{"name": str(n)[:256], "value": str(v)[:1024] or "-",
                        "inline": True} for n, v in fields][:25],
            "footer": {"text": "AiTradingAgent v4"},
        }
        if description:
            embed["description"] = description
        payload = {"username": "AiTradingAgent", "embeds": [embed]}
        try:
            self._q.put_nowait((url, payload))
        except queue.Full:
            self._to_backlog(url, payload)

    def _worker(self) -> None:
        while not self._stop.is_set():
            try:
                url, payload = self._q.get(timeout=1)
            except queue.Empty:
                continue
            if not self._send(url, payload):
                self._to_backlog(url, payload)
            time.sleep(0.45)  # stay under ~5 msgs / 2 s per webhook

    def _send(self, url: str, payload: dict, attempts: int = 4) -> bool:
        data = json.dumps(payload).encode("utf-8")
        for i in range(attempts):
            req = urllib.request.Request(
                url, data=data, method="POST",
                headers={"Content-Type": "application/json",
                         "User-Agent": "AiTradingAgent-DiscordFeed/1.0"})
            try:
                with urllib.request.urlopen(req, timeout=10):
                    return True
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    try:
                        wait = float(json.loads(e.read()).get("retry_after", 2))
                    except Exception:
                        wait = 2.0
                    time.sleep(min(wait, 30))
                    continue
                if 400 <= e.code < 500:
                    print(f"[discord_feed] rejected ({e.code}) - check webhook URL.")
                    return True  # don't backlog a message Discord will never accept
            except Exception:
                pass
            time.sleep(2 ** i)
        return False

    def _to_backlog(self, url: str, payload: dict) -> None:
        try:
            BACKLOG_FILE.parent.mkdir(parents=True, exist_ok=True)
            with BACKLOG_FILE.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"url": url, "payload": payload}) + "\n")
        except Exception:
            pass

    def _replay_backlog(self) -> None:
        if not BACKLOG_FILE.exists():
            return
        try:
            lines = BACKLOG_FILE.read_text(encoding="utf-8").splitlines()
            BACKLOG_FILE.unlink()
        except Exception:
            return
        for line in lines[-200:]:  # cap replay to the most recent 200
            try:
                item = json.loads(line)
                self._q.put_nowait((item["url"], item["payload"]))
            except Exception:
                continue


# One shared instance - import this everywhere.
feed = DiscordFeed()


# ------------------------------------------------------------ self-test ---
if __name__ == "__main__":
    if not feed.enabled:
        raise SystemExit("Set DISCORD_WEBHOOK_URL in your .env first.")
    feed.info("Discord feed test", "If you can read this, the feed works.")
    feed.trade("BTC/USDT", "buy", 64250.5, 0.01, strategy="ORB",
               confidence=0.74, exchange="Bitget sandbox")
    feed.consensus("BTC/USDT", "buy", {
        "claude": {"signal": "buy", "confidence": 0.8, "reason": "Breakout above range"},
        "hermes": {"signal": "buy", "confidence": 0.7, "reason": "Volume confirms"},
        "gemini": {"signal": "hold", "confidence": 0.5, "reason": "Resistance near"},
        "openrouter": {"signal": "buy", "confidence": 0.66, "reason": "Trend aligned"},
    })
    feed.veto("SOL/USDT", "Position would exceed max 5x leverage.", rule="max_leverage")
    feed.daily_summary(12, 8, 42.10, 1.35, best="ETH +3.1%", worst="ARB -1.2%",
                       running_win_rate=0.66, running_trades=140)
    feed.flush()
    print("Sent 5 test messages - check your Discord channel.")
