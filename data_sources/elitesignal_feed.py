"""
elitesignal_feed.py
===================
Data source: "Elite Signal - What's Hot, What's Not" daily Substack newsletter
(https://kirk296243.substack.com). Free, no API key - reads the public RSS feed.

What it provides (US equities + macro context, NOT direct crypto signals):
  - Market regime, VIX, stance, conviction score      -> macro risk-on/off context
  - Tier 1A buy calls with entry / target / stop       -> equity watchlist
  - Elite Hot List, Short Squeeze Watch, Risk Monitor  -> sentiment features
  - Emerging Trends "At Risk" / "Beneficiaries"        -> crypto-proxy flags
    (e.g. BITO, GBTC, IBIT, COIN, MSTR listed as At Risk = crypto headwind)

Outputs:
  data/external/elitesignal_latest.json   latest parsed briefing
  data/external/elitesignal_history.jsonl one line per post (for self-learning /
                                          scoring the newsletter's picks later)

Safety:
  - Informational only. Weighted LOW in consensus by default (ELITESIGNAL_WEIGHT).
  - Marks data as STALE if the newest post is older than ELITESIGNAL_MAX_AGE_DAYS,
    so the orchestrator ignores it instead of trading on old calls.

Run standalone:  python -m data_sources.elitesignal_feed
"""

import os
import re
import json
import html
import logging
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
import xml.etree.ElementTree as ET

import requests

log = logging.getLogger("EliteSignalFeed")

FEED_URL = os.getenv("ELITESIGNAL_FEED_URL", "https://kirk296243.substack.com/feed")
MAX_AGE_DAYS = float(os.getenv("ELITESIGNAL_MAX_AGE_DAYS", "3"))
WEIGHT = float(os.getenv("ELITESIGNAL_WEIGHT", "0.10"))  # low trust until scored
OUT_DIR = Path(os.getenv("ELITESIGNAL_OUT_DIR", Path(__file__).resolve().parent.parent / "data" / "external"))

CRYPTO_PROXIES = {"BITO", "GBTC", "IBIT", "FBTC", "ETHA", "ETHE", "COIN", "MSTR", "MARA", "RIOT", "HOOD", "CRCL"}
CONTENT_NS = "{http://purl.org/rss/1.0/modules/content/}encoded"
NUM = r"\$?([\d,]+(?:\.\d+)?)"


def _num(s: Optional[str]) -> Optional[float]:
    try:
        return float(s.replace(",", "").replace("$", "")) if s else None
    except ValueError:
        return None


def _html_to_lines(raw: str) -> List[str]:
    text = html.unescape(re.sub(r"<[^>]+>", "\n", raw or ""))
    lines = [ln.strip() for ln in text.split("\n")]
    # Substack splits "TICKER" and " — Price: ..." onto separate lines; re-join them
    merged: List[str] = []
    for ln in lines:
        if not ln:
            continue
        if merged and (ln.startswith("—") or ln.startswith("@") or ln.startswith("(")) and re.fullmatch(r"[A-Z.]{1,6}", merged[-1]):
            merged[-1] = f"{merged[-1]} {ln}"
        else:
            merged.append(ln)
    return merged


class EliteSignalFeed:
    """Fetches and parses the Elite Signal daily briefing RSS feed."""

    SECTION_MARKERS = {
        "hot_list": "Elite Hot List",
        "tier1a": "Tier 1A",
        "tier1b": "Tier 1B",
        "squeeze": "Short Squeeze Watch",
        "trending_up": "Trending Up",
        "high_upside": "High Upside",
        "risk_monitor": "Risk Monitor",
        "earnings": "Earnings Whisper",
        "covered_calls": "Covered Calls",
        "bull_put": "Bull Put Spreads",
        "bear_call": "Bear Call Spreads",
        "trends": "Emerging Trends",
        "conditions": "Market Conditions",
        "snapshot": "Market Snapshot",
    }

    def __init__(self, feed_url: str = FEED_URL, timeout: int = 20):
        self.feed_url = feed_url
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "AiTradingAgent/1.0 (+rss reader)"})

    # ---------------- fetch ----------------
    def fetch_posts(self, limit: int = 5) -> List[Dict[str, Any]]:
        r = self.session.get(self.feed_url, timeout=self.timeout)
        r.raise_for_status()
        root = ET.fromstring(r.content)
        posts = []
        for item in root.findall(".//item")[:limit]:
            content = item.find(CONTENT_NS)
            posts.append({
                "title": item.findtext("title", ""),
                "link": item.findtext("link", ""),
                "published": item.findtext("pubDate", ""),
                "html": content.text if content is not None else item.findtext("description", ""),
            })
        return posts

    # ---------------- parse ----------------
    def _split_sections(self, lines: List[str]) -> Dict[str, List[str]]:
        sections: Dict[str, List[str]] = {"header": []}
        current = "header"
        for ln in lines:
            hit = next((k for k, m in self.SECTION_MARKERS.items() if m in ln and len(ln) < 80), None)
            if hit:
                current = hit
                sections.setdefault(current, [])
                continue
            sections.setdefault(current, []).append(ln)
        return sections

    @staticmethod
    def _ticker_rows(lines: List[str]) -> List[Dict[str, Any]]:
        rows, cur = [], None
        for ln in lines:
            m = re.match(r"^([A-Z.]{1,6})\s+(?:—|@|\()", ln)
            if m:
                cur = {"ticker": m.group(1), "raw": ln}
                for key, pat in {
                    "price": r"(?:Price:|@)\s*" + NUM,
                    "v9": r"V9:?\s*(\d+)",
                    "risk": r"Risk:\s*(\d+)",
                    "short_float_pct": r"Short Float:\s*([\d.]+)%",
                    "days_to_cover": r"Days to Cover:\s*([\d.]+)",
                    "change_5d_pct": r"5d:\s*([+-]?[\d.]+)%",
                }.items():
                    mm = re.search(pat, ln)
                    if mm:
                        cur[key] = _num(mm.group(1))
                sm = re.search(r"Sector:\s*([A-Za-z .]+)", ln)
                if sm:
                    cur["sector"] = sm.group(1).strip(" ·")
                sig = re.search(r"Signal:\s*([A-Z]+)", ln)
                if sig:
                    cur["signal"] = sig.group(1)
                rows.append(cur)
                continue
            if cur is None:
                continue
            em = re.search(r"Entry:\s*" + NUM + r"\s*-\s*" + NUM, ln)
            if em:
                cur["entry_low"], cur["entry_high"] = _num(em.group(1)), _num(em.group(2))
            tm = re.search(r"Target:\s*" + NUM, ln)
            if tm:
                cur["target"] = _num(tm.group(1))
            st = re.search(r"Stop:\s*" + NUM, ln)
            if st:
                cur["stop"] = _num(st.group(1))
            if "thesis" not in cur and len(ln) > 60:
                cur["thesis"] = ln[:300]
        for row in rows:
            row.pop("raw", None)
        return rows

    @staticmethod
    def _macro(text: str) -> Dict[str, Any]:
        def grab(pat, cast=float):
            m = re.search(pat, text)
            return cast(m.group(1)) if m else None
        regime = re.search(r"Regime:\s*([A-Z ]+?)(?:\n|$|·)", text)
        return {
            "vix": grab(r"VIX:?\s*([\d.]+)"),
            "regime": regime.group(1).strip() if regime else None,
            "spy_change_pct": grab(r"SPY:.*?\(([+-]?[\d.]+)%\)"),
            "qqq_change_pct": grab(r"QQQ:.*?\(([+-]?[\d.]+)%\)"),
            "stance": (re.search(r"Stance:\s*\n?\s*([^\n·]+)", text) or [None, None])[1],
            "suggested_exposure": (re.search(r"Suggested exposure:\s*([\d\-–%]+)", text) or [None, None])[1],
            "conviction_score": grab(r"Conviction Score:\s*\n?\s*(\d+)", int),
            "distribution_days": grab(r"(\d+)\s+distribution days", int),
        }

    @staticmethod
    def _trends(lines: List[str]) -> List[Dict[str, Any]]:
        out, name = [], None
        for ln in lines:
            if ln.startswith("["):
                continue
            m = re.search(r"Beneficiaries:\s*(.*?)\s*·\s*At Risk:\s*(.*)$", ln)
            if m:
                split = lambda s: [t.strip() for t in s.split(",") if t.strip() and t.strip() != "N/A"]
                out.append({"trend": name, "beneficiaries": split(m.group(1)), "at_risk": split(m.group(2))})
            elif len(ln) < 60:
                name = ln
        return out

    def parse_post(self, post: Dict[str, Any]) -> Dict[str, Any]:
        lines = _html_to_lines(post["html"])
        text = "\n".join(lines)
        sec = self._split_sections(lines)
        try:
            published = parsedate_to_datetime(post["published"])
        except Exception:
            published = datetime.now(timezone.utc)
        age_days = (datetime.now(timezone.utc) - published).total_seconds() / 86400

        trends = self._trends(sec.get("trends", []))
        crypto_at_risk = sorted({t for tr in trends for t in tr["at_risk"] if t in CRYPTO_PROXIES})
        crypto_benefit = sorted({t for tr in trends for t in tr["beneficiaries"] if t in CRYPTO_PROXIES})
        macro = self._macro(text)

        return {
            "source": "elitesignal_substack",
            "title": post["title"],
            "link": post["link"],
            "published_utc": published.isoformat(),
            "age_days": round(age_days, 2),
            "stale": age_days > MAX_AGE_DAYS,
            "weight": WEIGHT,
            "macro": macro,
            "tier1a_buys": self._ticker_rows(sec.get("tier1a", [])),
            "tier1b_setups": self._ticker_rows(sec.get("tier1b", [])),
            "hot_list": self._ticker_rows(sec.get("hot_list", [])),
            "squeeze_watch": self._ticker_rows(sec.get("squeeze", [])),
            "trending_up": self._ticker_rows(sec.get("trending_up", [])),
            "risk_exits": self._ticker_rows(sec.get("risk_monitor", [])),
            "emerging_trends": trends,
            "crypto_context": {
                "at_risk_proxies": crypto_at_risk,
                "beneficiary_proxies": crypto_benefit,
                "bias": "bearish" if crypto_at_risk and not crypto_benefit
                        else "bullish" if crypto_benefit and not crypto_at_risk else "neutral",
            },
            "fetched_utc": datetime.now(timezone.utc).isoformat(),
        }

    # ---------------- agent-facing ----------------
    def get_latest(self, save: bool = True) -> Optional[Dict[str, Any]]:
        try:
            posts = self.fetch_posts(limit=1)
        except Exception as e:  # self-healing: fall back to last saved copy
            log.warning(f"EliteSignal fetch failed ({e}); using cached copy if present")
            return self.load_cached()
        if not posts:
            return self.load_cached()
        data = self.parse_post(posts[0])
        if save:
            self._save(data)
        if data["stale"]:
            log.warning(f"EliteSignal newest post is {data['age_days']:.0f} days old -> marked STALE (ignored by consensus)")
        return data

    def get_consensus_input(self) -> Dict[str, Any]:
        """Compact JSON in the agent contract: {signal, confidence, reason, constraints}."""
        d = self.get_latest()
        if not d or d.get("stale"):
            return {"signal": "HOLD", "confidence": 0.0,
                    "reason": "EliteSignal unavailable or stale", "constraints": ["ignore_source"]}
        m, c = d["macro"], d["crypto_context"]
        regime = (m.get("regime") or "").upper()
        risk_off = "BEAR" in regime or (m.get("vix") or 0) >= 25
        signal = "SELL" if (risk_off and c["bias"] == "bearish") else "BUY" if (not risk_off and c["bias"] == "bullish") else "HOLD"
        return {
            "signal": signal,
            "confidence": round(WEIGHT * ((m.get("conviction_score") or 50) / 100), 3),
            "reason": f"Regime {regime or 'n/a'}, VIX {m.get('vix')}, crypto-proxy bias {c['bias']} {c['at_risk_proxies'] or ''}",
            "constraints": ["macro_context_only", "equity_newsletter"],
        }

    def load_cached(self) -> Optional[Dict[str, Any]]:
        p = OUT_DIR / "elitesignal_latest.json"
        if p.exists():
            d = json.loads(p.read_text(encoding="utf-8"))
            d["from_cache"] = True
            return d
        return None

    def _save(self, data: Dict[str, Any]) -> None:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUT_DIR / "elitesignal_latest.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
        hist = OUT_DIR / "elitesignal_history.jsonl"
        seen = hist.read_text(encoding="utf-8") if hist.exists() else ""
        if data["link"] not in seen:  # one line per post, for later pick-scoring
            with hist.open("a", encoding="utf-8") as f:
                f.write(json.dumps(data) + "\n")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    feed = EliteSignalFeed()
    d = feed.get_latest()
    if d:
        print(f"\nPost: {d['title']}  ({d['published_utc'][:10]}, {d['age_days']:.0f} days old, stale={d['stale']})")
        print(f"Macro: {d['macro']}")
        print(f"Tier 1A buys: {[r['ticker'] for r in d['tier1a_buys']]}")
        print(f"Hot list: {[r['ticker'] for r in d['hot_list']]}")
        print(f"Squeeze: {[r['ticker'] for r in d['squeeze_watch']]}")
        print(f"Risk exits: {[r['ticker'] for r in d['risk_exits']]}")
        print(f"Crypto context: {d['crypto_context']}")
        print(f"Consensus input: {feed.get_consensus_input()}")
        print(f"\nSaved to {OUT_DIR}")
