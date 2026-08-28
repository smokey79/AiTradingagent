"""
peer_rotation.py
================
Cross-token peer rotation and sector momentum analysis.
Tracks capital flows between BTC, Major L1s (SOL, AVAX), and L2s (ARB, OP).
"""

from typing import List, Dict, Any, Optional

SECTOR_MAP = {
    "BTC/USDT": "Store of Value / Core",
    "ETH/USDT": "Smart Contract Leader",
    "SOL/USDT": "High-Throughput L1",
    "AVAX/USDT": "High-Throughput L1",
    "ARB/USDT": "Ethereum L2 Rollup",
    "OP/USDT": "Ethereum L2 Rollup",
    "CRO/USDT": "Exchange & App Chain",
}


def analyze_peer_rotation(tickers: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Evaluates relative capital rotation across sectors from ticker 24h change and volume.
    """
    sector_performance = {}
    tokens_by_change = sorted(tickers, key=lambda x: x.get("change_24h", 0.0), reverse=True)

    for t in tickers:
        sym = t.get("symbol", "")
        sec = SECTOR_MAP.get(sym, "Other")
        if sec not in sector_performance:
            sector_performance[sec] = {"total_change": 0.0, "total_vol": 0.0, "count": 0}
        sector_performance[sec]["total_change"] += t.get("change_24h", 0.0)
        sector_performance[sec]["total_vol"] += t.get("volume_24h", 0.0)
        sector_performance[sec]["count"] += 1

    sector_summary = []
    for sec, data in sector_performance.items():
        avg_change = data["total_change"] / max(data["count"], 1)
        sector_summary.append({
            "sector": sec,
            "avg_24h_change_pct": round(avg_change, 2),
            "total_volume_usdt": round(data["total_vol"], 2),
            "token_count": data["count"],
        })

    sector_summary.sort(key=lambda x: x["avg_24h_change_pct"], reverse=True)

    leading_token = tokens_by_change[0]["symbol"] if tokens_by_change else "None"
    lagging_token = tokens_by_change[-1]["symbol"] if tokens_by_change else "None"

    # Identify rotation direction
    rotation_regime = "BALANCED"
    if sector_summary:
        top_sector = sector_summary[0]["sector"]
        if "L2" in top_sector:
            rotation_regime = "L2_ROTATION (High Beta)"
        elif "L1" in top_sector:
            rotation_regime = "ALT_L1_ROTATION (Risk-On)"
        elif "Store of Value" in top_sector:
            rotation_regime = "BTC_DEFENSIVE_CONSOLIDATION"

    return {
        "rotation_regime": rotation_regime,
        "leading_token": leading_token,
        "lagging_token": lagging_token,
        "sector_rankings": sector_summary,
        "token_rankings": [
            {"symbol": t.get("symbol"), "change_24h": t.get("change_24h"), "price": t.get("price")}
            for t in tokens_by_change
        ],
    }
