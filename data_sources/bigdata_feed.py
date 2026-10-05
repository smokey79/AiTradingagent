"""
bigdata_feed.py
===============
Data source: Bigdata.com (https://bigdata.com) news / research / filings search API.
Turns recent news sentiment into agent-consensus votes for each coin, plus a macro
(Fed / rates / oil / dollar) risk-on/risk-off read.

Endpoint:  POST https://api.bigdata.com/v1/search   (header: X-API-KEY)
Docs:      https://docs.bigdata.com/getting-started/quickstart_guide

Env vars (put in .env - NEVER hard-code the key):
  BIGDATA_API_KEY          required. If missing, this source abstains (HOLD, conf 0).
  BIGDATA_ASSETS           default "BTC,ETH,SOL,CRO,AVAX,ARB,OP"
  BIGDATA_LOOKBACK_HOURS   default 24
  BIGDATA_MIN_CHUNKS       default 8   (below this -> too little evidence -> abstain)
  BIGDATA_WEIGHT           default 0.15 (low trust until scored by strategyLearner)
  BIGDATA_CACHE_MINUTES    default 30  (saves API quota; bot re-uses last result)
  BIGDATA_MAX_CACHE_HOURS  default 6   (older cache = stale = ignored)

Outputs:
  data/external/bigdata_latest.json    latest sentiment snapshot
  data/external/bigdata_history.jsonl  one line per refresh (for self-learning scoring)

Rules followed:
  - Only real measured scores from the API. No synthetic / invented fallback figures.
  - Abstains on missing key, errors with no fresh cache, or too few chunks.
  - Informational vote only; the Risk Gate still has hard veto.

Run standalone:  venv\\Scripts\\python.exe -m data_sources.bigdata_feed
"""

import os
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

log = logging.getLogger("BigdataFeed")

API_URL = os.getenv("BIGDATA_API_URL", "https://api.bigdata.com/v1/search")
ASSETS = [a.strip().upper() for a in os.getenv("BIGDATA_ASSETS", "BTC,ETH,SOL,CRO,AVAX,ARB,OP").split(",") if a.strip()]
LOOKBACK_HOURS = float(os.getenv("BIGDATA_LOOKBACK_HOURS", "24"))
MIN_CHUNKS = int(os.getenv("BIGDATA_MIN_CHUNKS", "8"))
WEIGHT = float(os.getenv("BIGDATA_WEIGHT", "0.15"))
CACHE_MINUTES = float(os.getenv("BIGDATA_CACHE_MINUTES", "30"))
MAX_CACHE_HOURS = float(os.getenv("BIGDATA_MAX_CACHE_HOURS", "6"))
OUT_DIR = Path(os.getenv("BIGDATA_OUT_DIR", Path(__file__).resolve().parent.parent / "data" / "external"))

# Search text + exact keywords per asset (keywords stop "OP"/"ARB" matching random words)
ASSET_QUERIES: Dict[str, Dict[str, Any]] = {
    "BTC":  {"text": "Bitcoin price outlook and crypto market sentiment", "keywords": ["Bitcoin"]},
    "ETH":  {"text": "Ethereum price outlook and ETH market sentiment", "keywords": ["Ethereum"]},
    "SOL":  {"text": "Solana price outlook and SOL market sentiment", "keywords": ["Solana"]},
    "CRO":  {"text": "Cronos CRO token and Crypto.com exchange news", "keywords": ["Cronos", "Crypto.com"]},
    "AVAX": {"text": "Avalanche AVAX token price and network news", "keywords": ["Avalanche"]},
    "ARB":  {"text": "Arbitrum ARB token price and network news", "keywords": ["Arbitrum"]},
    "OP":   {"text": "Optimism OP token price and network news", "keywords": ["Optimism"]},
    "LTC":  {"text": "Litecoin price outlook", "keywords": ["Litecoin"]},
    "SUI":  {"text": "Sui blockchain SUI token price news", "keywords": ["Sui"]},
    "AAVE": {"text": "Aave protocol AAVE token news", "keywords": ["Aave"]},
}
MACRO_QUERY = {
    "text": "Federal Reserve interest rate expectations, Treasury yields, dollar and oil impact on risk assets",
    "keywords": ["Federal Reserve", "Treasury", "yields", "oil"],
}


class BigdataFeed:
    """Queries Bigdata.com and converts chunk sentiment into consensus votes."""

    def __init__(self, api_key: Optional[str] = None, timeout: int = 30):
        self.api_key = api_key or os.getenv("BIGDATA_API_KEY", "").strip()
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json", "User-Agent": "AiTradingAgent/1.0"})
        if self.api_key:
            self.session.headers["X-API-KEY"] = self.api_key

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    # ---------------- fetch ----------------
    def search(self, text: str, keywords: List[str], max_chunks: int = 40) -> List[Dict[str, Any]]:
        """Returns a flat list of chunks: {sentiment, relevance, headline, source, url, timestamp}."""
        end = datetime.now(timezone.utc)
        start = end - timedelta(hours=LOOKBACK_HOURS)
        body = {
            "search_mode": "fast",
            "query": {
                "text": text,
                "filters": {
                    "timestamp": {"start": start.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                                  "end": end.strftime("%Y-%m-%dT%H:%M:%S.000Z")},
                    "keyword": {"any_of": keywords, "search_in": "ALL"},
                },
                "max_chunks": max_chunks,
            },
        }
        r = self.session.post(API_URL, json=body, timeout=self.timeout)
        if r.status_code in (401, 403):
            raise PermissionError(f"Bigdata.com rejected the API key (HTTP {r.status_code})")
        r.raise_for_status()
        payload = r.json()
        docs = payload.get("results") or payload.get("documents") or []
        chunks: List[Dict[str, Any]] = []
        for d in docs:
            for c in d.get("chunks", []):
                s = c.get("sentiment")
                if isinstance(s, dict):  # tolerate {"value": x} shape
                    s = s.get("value")
                if s is None:
                    continue
                chunks.append({
                    "sentiment": float(s),
                    "relevance": float(c.get("relevance") or 1.0),
                    "headline": d.get("headline", ""),
                    "source": (d.get("source") or {}).get("name", ""),
                    "url": d.get("url", ""),
                    "timestamp": d.get("timestamp", ""),
                })
        return chunks

    # ---------------- score ----------------
    @staticmethod
    def score(chunks: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Relevance-weighted mean sentiment (-1..1) + agreement + evidence count."""
        n = len(chunks)
        if n == 0:
            return {"n_chunks": 0, "n_docs": 0, "sentiment": None, "agreement": None, "top_headlines": []}
        wsum = sum(c["relevance"] for c in chunks) or 1.0
        mean = sum(c["sentiment"] * c["relevance"] for c in chunks) / wsum
        direction = 1 if mean >= 0 else -1
        agree = sum(1 for c in chunks if (c["sentiment"] >= 0) == (direction > 0)) / n
        docs = {c["url"] or c["headline"] for c in chunks}
        top = sorted(chunks, key=lambda c: abs(c["sentiment"]) * c["relevance"], reverse=True)[:3]
        return {
            "n_chunks": n,
            "n_docs": len(docs),
            "sentiment": round(mean, 4),
            "agreement": round(agree, 3),
            "top_headlines": [{"headline": t["headline"], "source": t["source"],
                               "sentiment": t["sentiment"], "url": t["url"]} for t in top],
        }

    # ---------------- refresh + cache (self-healing) ----------------
    def refresh(self, assets: Optional[List[str]] = None, force: bool = False) -> Optional[Dict[str, Any]]:
        """Fetch fresh sentiment (or reuse cache younger than BIGDATA_CACHE_MINUTES)."""
        cached = self.load_cached()
        if cached and not force and cached.get("age_minutes", 1e9) < CACHE_MINUTES:
            return cached
        if not self.enabled:
            if not getattr(self, "_warned_no_key", False):
                log.warning("BIGDATA_API_KEY not set -> Bigdata.com source abstains")
                self._warned_no_key = True
            return cached
        assets = assets or ASSETS
        snap: Dict[str, Any] = {"source": "bigdata.com", "weight": WEIGHT,
                                "lookback_hours": LOOKBACK_HOURS, "assets": {}, "errors": {}}
        try:
            snap["macro"] = self.score(self.search(**MACRO_QUERY))
        except PermissionError as e:
            log.error(str(e))
            return cached
        except Exception as e:
            log.warning(f"Bigdata macro query failed: {e}")
            snap["errors"]["MACRO"] = str(e)[:200]
            snap["macro"] = self.score([])
        for a in assets:
            q = ASSET_QUERIES.get(a) or {"text": f"{a} cryptocurrency price outlook", "keywords": [a]}
            try:
                snap["assets"][a] = self.score(self.search(q["text"], q["keywords"]))
            except Exception as e:
                log.warning(f"Bigdata query for {a} failed: {e}")
                snap["errors"][a] = str(e)[:200]
        if not snap["assets"] and cached:  # total failure -> keep last good copy
            return cached
        snap["fetched_utc"] = datetime.now(timezone.utc).isoformat()
        self._save(snap)
        snap["age_minutes"] = 0.0
        return snap

    def load_cached(self) -> Optional[Dict[str, Any]]:
        p = OUT_DIR / "bigdata_latest.json"
        if not p.exists():
            return None
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(d["fetched_utc"])).total_seconds() / 60
            d["age_minutes"] = round(age, 1)
            d["stale"] = age > MAX_CACHE_HOURS * 60
            d["from_cache"] = True
            return d
        except Exception as e:
            log.warning(f"Bigdata cache unreadable ({e}); ignoring it")
            return None

    def _save(self, snap: Dict[str, Any]) -> None:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUT_DIR / "bigdata_latest.json").write_text(json.dumps(snap, indent=2), encoding="utf-8")
        with (OUT_DIR / "bigdata_history.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(snap) + "\n")

    # ---------------- agent-facing ----------------
    def get_consensus_input(self, asset: str = "BTC") -> Dict[str, Any]:
        """One vote in the agent contract: {signal, confidence, reason, constraints}."""
        asset = asset.upper().split("/")[0]
        abstain = lambda why: {"signal": "HOLD", "confidence": 0.0, "reason": f"Bigdata.com: {why}",
                               "constraints": ["ignore_source"]}
        snap = self.refresh()
        if not snap:
            return abstain("no API key and no cached data" if not self.enabled else "no data")
        if snap.get("stale"):
            return abstain(f"cache {snap.get('age_minutes')} min old (stale)")
        s = snap.get("assets", {}).get(asset)
        if not s or s.get("n_chunks", 0) < MIN_CHUNKS:
            return abstain(f"only {s.get('n_chunks', 0) if s else 0} news chunks for {asset} "
                           f"in {LOOKBACK_HOURS:.0f}h (< {MIN_CHUNKS}) - sample too small")
        sent, agree = s["sentiment"], s["agreement"]
        signal = "HOLD"
        if agree >= 0.6 and sent >= 0.15:
            signal = "BUY"
        elif agree >= 0.6 and sent <= -0.15:
            signal = "SELL"
        conf = WEIGHT * min(1.0, abs(sent) / 0.5) * agree
        constraints = ["news_sentiment_only"]
        macro = snap.get("macro") or {}
        m = macro.get("sentiment")
        if m is not None and macro.get("n_chunks", 0) >= MIN_CHUNKS and m <= -0.15 and signal == "BUY":
            conf *= 0.5  # risk-off macro backdrop halves long conviction
            constraints.append("macro_risk_off")
        return {
            "signal": signal,
            "confidence": round(conf if signal != "HOLD" else 0.0, 3),
            "reason": (f"Bigdata.com {asset}: sentiment {sent:+.2f}, {agree:.0%} agreement, "
                       f"{s['n_chunks']} chunks / {s['n_docs']} docs ({LOOKBACK_HOURS:.0f}h); "
                       f"macro {m if m is None else round(m, 2)}"),
            "constraints": constraints,
        }

    def get_all_votes(self) -> Dict[str, Dict[str, Any]]:
        return {a: self.get_consensus_input(a) for a in ASSETS}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    try:
        from dotenv import load_dotenv  # optional; reads F:\\aitradingagent\\.env
        load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    except ImportError:
        pass
    feed = BigdataFeed()
    print(f"\nBigdata.com enabled: {feed.enabled}  (key present: {'yes' if feed.enabled else 'NO - add BIGDATA_API_KEY to .env'})")
    snap = feed.refresh(force=feed.enabled)
    if snap:
        print(f"Macro: {snap.get('macro', {}).get('sentiment')}  errors: {snap.get('errors')}")
        for a, s in snap.get("assets", {}).items():
            print(f"  {a:5} sentiment={s.get('sentiment')} agree={s.get('agreement')} chunks={s.get('n_chunks')}")
    for a, v in feed.get_all_votes().items():
        print(f"VOTE {a:5} -> {v['signal']:4} conf={v['confidence']}  {v['reason']}")
    print(f"\nFiles: {OUT_DIR}")
