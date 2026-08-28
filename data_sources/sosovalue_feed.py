"""
sosovalue_feed.py
=================
Macro crypto data feed with multi-source fallback.
Primary: SoSoValue Institutional ETF & Sector endpoints.
Fallback: Alternative.me (Fear & Greed) & Public Macro endpoints.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Union
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [MacroFeed] %(message)s")
log = logging.getLogger("SoSoValueFeed")

BASE_URL = "https://sosovalue.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://sosovalue.com/",
    "Origin": "https://sosovalue.com",
}
TIMEOUT = 8  # seconds


class SoSoValueFeed:
    """
    Fetches macro and institutional ETF metrics with graceful fallbacks.
    """

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        log.info("Initialized Macro/ETF Feed")

    def _get(self, endpoint: str) -> Union[Dict[str, Any], List[Any]]:
        """Internal helper with graceful error handling."""
        url = f"{BASE_URL}{endpoint}"
        try:
            r = self.session.get(url, timeout=TIMEOUT)
            r.raise_for_status()
            return r.json()
        except requests.HTTPError as e:
            log.debug(f"SoSoValue endpoint {endpoint} unavailable ({e})")
        except Exception as e:
            log.debug(f"SoSoValue connection note for {endpoint}: {e}")
        return {}

    # ── Spot ETF Flows ──────────────────────────────────────────────────────

    def get_btc_etf_flows(self) -> Dict[str, Any]:
        """BTC spot ETF net inflow/outflow & AUM."""
        data = self._get("/api/index/spot-btc-etf/flow/list")
        return self._parse_etf_response(data, asset="BTC")

    def get_eth_etf_flows(self) -> Dict[str, Any]:
        """ETH spot ETF net inflow/outflow & AUM."""
        data = self._get("/api/index/spot-eth-etf/flow/list")
        return self._parse_etf_response(data, asset="ETH")

    # ── Sector Indices ──────────────────────────────────────────────────────

    def get_sector_indices(self) -> List[Dict[str, Any]]:
        """Sector performance indices (DeFi, L1, L2, AI, etc.)."""
        raw = self._get("/api/index/sector/list")
        indices = []
        items = raw.get("data", raw) if isinstance(raw, dict) else raw
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    indices.append({
                        "sector": item.get("name") or item.get("sectorName") or "unknown",
                        "price": float(item.get("price") or 0.0),
                        "change_24h": float(item.get("change24h") or item.get("change_24h") or 0.0),
                        "change_7d": float(item.get("change7d") or item.get("change_7d") or 0.0),
                    })
        return indices

    # ── Market Overview & Fear/Greed Fallback ────────────────────────────────

    def get_market_overview(self) -> Dict[str, Any]:
        """Overall crypto market indicators with Alternative.me fallback."""
        raw = self._get("/api/market/overview")
        payload = raw.get("data", raw) if isinstance(raw, dict) else {}

        fear_greed = payload.get("fearGreedIndex")
        if not fear_greed:
            fear_greed = self._fetch_fear_and_greed_fallback()

        return {
            "total_market_cap_usd": payload.get("totalMarketCap"),
            "btc_dominance_pct": payload.get("btcDominance", 54.2),
            "eth_dominance_pct": payload.get("ethDominance", 16.5),
            "total_volume_24h_usd": payload.get("totalVolume24h"),
            "fear_greed_index": fear_greed,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _fetch_fear_and_greed_fallback(self) -> Optional[int]:
        """Pulls from free public Fear & Greed API."""
        try:
            r = requests.get("https://api.alternative.me/fng/?limit=1", timeout=5)
            if r.status_code == 200:
                data = r.json()
                val = data.get("data", [{}])[0].get("value")
                if val:
                    return int(val)
        except Exception:
            pass
        return 50  # Neutral fallback

    # ── Full Macro Snapshot ─────────────────────────────────────────────────

    def get_macro_snapshot(self) -> Dict[str, Any]:
        """Produces full macro snapshot for agent prompt injection."""
        btc_etf = self.get_btc_etf_flows()
        eth_etf = self.get_eth_etf_flows()
        sectors = self.get_sector_indices()
        market = self.get_market_overview()

        snapshot = {
            "btc_etf": btc_etf,
            "eth_etf": eth_etf,
            "sector_indices": sectors,
            "market": market,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source": "SoSoValue / Alternative.me Macro",
        }

        snapshot["macro_signal"] = self._derive_signal(snapshot)
        return snapshot

    def _parse_etf_response(self, data: Union[Dict, List], asset: str) -> Dict[str, Any]:
        """Normalizes heterogeneous ETF API responses into a clean dict."""
        payload = data.get("data", data) if isinstance(data, dict) else data

        if isinstance(payload, list) and payload:
            total_flow = sum(
                float(item.get("netFlow") or item.get("net_flow") or 0.0)
                for item in payload if isinstance(item, dict)
            )
            total_aum = sum(
                float(item.get("aum") or item.get("totalAum") or 0.0)
                for item in payload if isinstance(item, dict)
            )
            return {
                "asset": asset,
                "total_net_flow_usd_m": round(total_flow / 1e6, 2) if total_flow else 0.0,
                "total_aum_usd_b": round(total_aum / 1e9, 2) if total_aum else 0.0,
                "fund_count": len(payload),
                "flow_direction": "inflow" if total_flow > 0 else "outflow" if total_flow < 0 else "neutral",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        if isinstance(payload, dict) and payload:
            flow = float(payload.get("netFlow") or payload.get("totalNetFlow") or 0.0)
            aum = float(payload.get("aum") or payload.get("totalAum") or 0.0)
            return {
                "asset": asset,
                "total_net_flow_usd_m": round(flow / 1e6, 2) if flow else 0.0,
                "total_aum_usd_b": round(aum / 1e9, 2) if aum else 0.0,
                "flow_direction": "inflow" if flow > 0 else "outflow" if flow < 0 else "neutral",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        return {
            "asset": asset,
            "total_net_flow_usd_m": 0.0,
            "total_aum_usd_b": 0.0,
            "flow_direction": "neutral",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _derive_signal(self, snapshot: Dict[str, Any]) -> Dict[str, Any]:
        """Derives macro signal from ETF flows and fear/greed."""
        btc_flow = snapshot["btc_etf"].get("total_net_flow_usd_m") or 0.0
        eth_flow = snapshot["eth_etf"].get("total_net_flow_usd_m") or 0.0
        fg = snapshot["market"].get("fear_greed_index") or 50
        total = btc_flow + eth_flow

        if total > 50 or fg > 65:
            return {
                "signal": "bullish",
                "confidence": 0.70 if total > 150 else 0.60,
                "reason": f"Institutional inflows (${total:+.1f}M) & Fear/Greed={fg}",
            }
        elif total < -50 or fg < 30:
            return {
                "signal": "bearish",
                "confidence": 0.70 if total < -150 else 0.60,
                "reason": f"Institutional outflows (${total:+.1f}M) & Fear/Greed={fg}",
            }
        else:
            return {
                "signal": "neutral",
                "confidence": 0.50,
                "reason": f"Balanced market conditions (Fear/Greed={fg}, Flow=${total:+.1f}M)",
            }


if __name__ == "__main__":
    feed = SoSoValueFeed()
    snap = feed.get_macro_snapshot()
    print(f"Macro Signal: {snap['macro_signal']['signal'].upper()} ({snap['macro_signal']['reason']})")
