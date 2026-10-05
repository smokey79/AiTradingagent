"""
scripts/bigdata_analyst.py

Periodic refresher for the Bigdata.com news/macro sentiment feed
(data_sources/bigdata_feed.py). That module already knows how to fetch,
score and cache Bigdata.com data — this script's only job is to call its
refresh() on a schedule so src/agents/bigdataAgent.js (the fast Node-side
reader used by the live consensus vote) always has a recent
data/external/bigdata_latest.json to read, without any Node consensus
cycle ever having to wait on a slow HTTP call itself.

Runs on its own long interval (default 30 min, matching bigdata_feed.py's
own BIGDATA_CACHE_MINUTES default) since news/macro sentiment does not
need second-by-second freshness, and Bigdata.com API quota is finite.
Self-healing: if BIGDATA_API_KEY is blank or a request fails, refresh()
already abstains cleanly and keeps serving the last good cache — this
loop just logs that and tries again next interval.

2026-09-28 (Alan's explicit instruction): added as part of wiring
Bigdata.com into the live vote as a 4th real agent, alongside
claude/openrouter_free/oanda_sentiment — see
src/agents/bigdataAgent.js and src/orchestrator/consensus.js.

Alan J | barcay0611@gmail.com
"""

from __future__ import annotations

import logging
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

os.makedirs(ROOT / "logs", exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [bigdata-analyst] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(ROOT / "logs" / "bigdata-analyst.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger("bigdata_analyst")

REFRESH_INTERVAL_S = int(os.getenv("BIGDATA_REFRESH_INTERVAL_S", "1800"))  # 30 min default


def main() -> None:
    from data_sources.bigdata_feed import BigdataFeed

    feed = BigdataFeed()
    if not feed.enabled:
        logger.warning(
            "BIGDATA_API_KEY not set in .env -> this process will keep "
            "checking every %ss but the feed will abstain (HOLD, conf 0) "
            "until a key is added. No trades are affected by this.",
            REFRESH_INTERVAL_S,
        )
    while True:
        try:
            snap = feed.refresh()
            if snap and snap.get("assets"):
                macro = (snap.get("macro") or {}).get("sentiment")
                per_asset = ", ".join(
                    f"{a}={s.get('sentiment')}({s.get('n_chunks', 0)}c)"
                    for a, s in snap.get("assets", {}).items()
                )
                logger.info("Refreshed. macro=%s | %s", macro, per_asset)
            else:
                logger.info("No fresh data this cycle (abstaining or cached).")
        except Exception as e:
            logger.warning("Refresh cycle failed (will retry next interval): %s", e)
        time.sleep(REFRESH_INTERVAL_S)


if __name__ == "__main__":
    main()
