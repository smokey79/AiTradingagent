"""
sosovalue_feed.py
=================
Macro crypto data from SoSoValue free public endpoints.
Covers: BTC ETF flows, ETH ETF flows, crypto sector indices.

File location: C:\\Users\\AlanJ\\projects\\AiTradingagent\\data_sources\\sosovalue_feed.py

No API key needed for free tier.

Usage:
    from data_sources.sosovalue_feed import SoSoValueFeed
    feed = SoSoValueFeed()
    macro = feed.get_macro_snapshot()
"""

import requests
import logging
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format="%(asctime)s [SoSoValue] %(message)s")
log = logging.getLogger(__name__)

BASE_URL = "https://sosovalue.com"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; AiTradingAgent/1.0)",
    "Accept":     "application/json",
    "Referer":    BASE_URL,
}

TIMEOUT = 10   # seconds


class SoSoValueFeed:
    """
    Fetches publicly available macro data from SoSoValue.
    All endpoints below are free — no auth required.
    """

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        log.info("SoSoValue feed initialised (free tier)")

    # ── BTC Spot ETF ────────────────────────────────────────────────────────

    def get_btc_etf_flows(self) -> dict:
        """
        BTC spot ETF total net flow and AUM.
        Covers: BlackRock IBIT, Fidelity FBTC, ARK 21Shares, etc.
        """
        url = f"{BASE_URL}/api/index/spot-btc-etf/flow/list"
        try:
            r = self.session.get(url, timeout=TIMEOUT)
            r.raise_for_status()
            data = r.json()

            # Summarise for agent consumption
            summary = self._parse_etf_response(data, asset="BTC")
            log.info(f"BTC ETF | Net Flow: ${summary.get('total_net_flow_usd_m', 'N/A')}M")
            return summary

        except requests.HTTPError as e:
            log.warning(f"BTC ETF HTTP error: {e}")
        except Exception as e:
            log.error(f"BTC ETF fetch failed: {e}")
        return self._empty_etf("BTC")

    # ── ETH Spot ETF ────────────────────────────────────────────────────────

    def get_eth_etf_flows(self) -> dict:
        """
        ETH spot ETF total net flow and AUM.
        Covers: BlackRock ETHA, Fidelity FETH, etc.
        """
        url = f"{BASE_URL}/api/index/spot-eth-etf/flow/list"
        try:
            r = self.session.get(url, timeout=TIMEOUT)
            r.raise_for_status()
            data = r.json()
            summary = self._parse_etf_response(data, asset="ETH")
            log.info(f"ETH ETF | Net Flow: ${summary.get('total_net_flow_usd_m', 'N/A')}M")
            return summary
        except Exception as e:
            log.error(f"ETH ETF fetch failed: {e}")
        return self._empty_etf("ETH")

    # ── Crypto Sector Indices ───────────────────────────────────────────────

    def get_sector_indices(self) -> list[dict]:
        """
        Sector performance indices: DeFi, L1, L2, AI tokens, etc.
        Useful for your 7-token universe relative strength signals.
        """
        url = f"{BASE_URL}/api/index/sector/list"
        try:
            r = self.session.get(url, timeout=TIMEOUT)
            r.raise_for_status()
            raw = r.json()

            indices = []
            items = raw.get("data", raw) if isinstance(raw, dict) else raw
            if isinstance(items, list):
                for item in items:
                    indices.append({
                        "sector":     item.get("name", "unknown"),
                        "price":      item.get("price"),
                        "change_24h": item.get("change24h"),
                        "change_7d":  item.get("change7d"),
                    })
            log.info(f"Fetched {len(indices)} sector indices")
            return indices

        except Exception as e:
            log.error(f"Sector indices fetch failed: {e}")
            return []

    # ── Market Overview ─────────────────────────────────────────────────────

    def get_market_overview(self) -> dict:
        """
        Top-level crypto market data: total market cap, BTC dominance, etc.
        """
        url = f"{BASE_URL}/api/market/overview"
        try:
            r = self.session.get(url, timeout=TIMEOUT)
            r.raise_for_status()
            data = r.json()
            payload = data.get("data", data)
            return {
                "total_market_cap_usd":  payload.get("totalMarketCap"),
                "btc_dominance_pct":     payload.get("btcDominance"),
                "eth_dominance_pct":     payload.get("ethDominance"),
                "total_volume_24h_usd":  payload.get("totalVolume24h"),
                "fear_greed_index":      payload.get("fearGreedIndex"),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            log.error(f"Market overview fetch failed: {e}")
            return {}

    # ── Full Macro Snapshot ─────────────────────────────────────────────────

    def get_macro_snapshot(self) -> dict:
        """
        Single call returning all macro data for agent injection.
        Feed this into your GPT-4o (macro agent) and Perplexity (research agent).
        """
        log.info("Building full macro snapshot...")
        snapshot = {
            "btc_etf":        self.get_btc_etf_flows(),
            "eth_etf":        self.get_eth_etf_flows(),
            "sector_indices": self.get_sector_indices(),
            "market":         self.get_market_overview(),
            "fetched_at":     datetime.now(timezone.utc).isoformat(),
            "source":         "SoSoValue (free tier)",
        }

        # Derive simple sentiment signal for agents
        snapshot["macro_signal"] = self._derive_signal(snapshot)
        return snapshot

    # ── Helpers ─────────────────────────────────────────────────────────────

    def _parse_etf_response(self, data: dict | list, asset: str) -> dict:
        """Normalise ETF API response into a flat dict agents can read."""
        payload = data.get("data", data) if isinstance(data, dict) else data

        if isinstance(payload, list) and payload:
            # Sum flows across all funds
            total_flow = sum(
                float(item.get("netFlow", item.get("net_flow", 0)) or 0)
                for item in payload
            )
            total_aum = sum(
                float(item.get("aum", item.get("totalAum", 0)) or 0)
                for item in payload
            )
            return {
                "asset":               asset,
                "total_net_flow_usd_m": round(total_flow / 1e6, 2),
                "total_aum_usd_b":     round(total_aum / 1e9, 2),
                "fund_count":          len(payload),
                "flow_direction":      "inflow" if total_flow > 0 else "outflow",
                "timestamp":           datetime.now(timezone.utc).isoformat(),
            }

        if isinstance(payload, dict):
            flow = float(payload.get("netFlow", payload.get("totalNetFlow", 0)) or 0)
            return {
                "asset":               asset,
                "total_net_flow_usd_m": round(flow / 1e6, 2),
                "total_aum_usd_b":     round(float(payload.get("aum", 0) or 0) / 1e9, 2),
                "flow_direction":      "inflow" if flow > 0 else "outflow",
                "timestamp":           datetime.now(timezone.utc).isoformat(),
            }

        return self._empty_etf(asset)

    def _empty_etf(self, asset: str) -> dict:
        return {
            "asset": asset,
            "total_net_flow_usd_m": None,
            "total_aum_usd_b": None,
            "flow_direction": "unknown",
            "error": "data unavailable",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _derive_signal(self, snapshot: dict) -> dict:
        """
        Simple rules-based macro signal from ETF flow data.
        Returns: { signal: 'bullish'|'bearish'|'neutral', confidence: 0-1 }
        Agents can override this with deeper reasoning.
        """
        btc_flow = snapshot["btc_etf"].get("total_net_flow_usd_m")
        eth_flow = snapshot["eth_etf"].get("total_net_flow_usd_m")

        if btc_flow is None and eth_flow is None:
            return {"signal": "neutral", "confidence": 0.0, "reason": "no ETF data"}

        total = (btc_flow or 0) + (eth_flow or 0)

        if total > 200:
            return {"signal": "bullish", "confidence": 0.75,
                    "reason": f"Strong ETF inflow: ${total:.0f}M combined"}
        elif total > 50:
            return {"signal": "bullish", "confidence": 0.55,
                    "reason": f"Moderate ETF inflow: ${total:.0f}M"}
        elif total < -200:
            return {"signal": "bearish", "confidence": 0.75,
                    "reason": f"Strong ETF outflow: ${total:.0f}M"}
        elif total < -50:
            return {"signal": "bearish", "confidence": 0.55,
                    "reason": f"Moderate ETF outflow: ${total:.0f}M"}
        else:
            return {"signal": "neutral", "confidence": 0.5,
                    "reason": f"Mixed ETF flows: ${total:.0f}M"}


# ── Quick test ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    feed = SoSoValueFeed()
    snap = feed.get_macro_snapshot()

    print("\n=== MACRO SNAPSHOT ===")
    print(f"BTC ETF Flow: ${snap['btc_etf'].get('total_net_flow_usd_m', 'N/A')}M "
          f"({snap['btc_etf'].get('flow_direction', '')})")
    print(f"ETH ETF Flow: ${snap['eth_etf'].get('total_net_flow_usd_m', 'N/A')}M "
          f"({snap['eth_etf'].get('flow_direction', '')})")
    print(f"Macro Signal: {snap['macro_signal']['signal'].upper()} "
          f"(confidence: {snap['macro_signal']['confidence']:.0%})")
    print(f"Reason: {snap['macro_signal']['reason']}")
    print(f"\nSectors fetched: {len(snap['sector_indices'])}")
