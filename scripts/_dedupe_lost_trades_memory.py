"""One-off cleanup: collapse duplicate/placeholder entries in lost_trades_memory.json.

Root cause (fixed separately in src/agents/learningAgent.js and src/learning/lossLearner.js):
learningAgent.js was calling recordLossPostMortem() with positional args instead of the
options object the function expects, so every batch-reviewed loss was written as an
identical generic placeholder. This script cleans up the damage already done to the data
file. It NEVER overwrites the original without a timestamped backup first.
"""
import json
import shutil
import collections
from datetime import datetime, timezone

SRC = r"F:\aitradingagent\data\lost_trades_memory.json"
backup = SRC.replace(".json", f".backup-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json")
shutil.copy2(SRC, backup)
print("Backed up original to:", backup)

with open(SRC, "r", encoding="utf-8") as f:
    records = json.load(f)

print("Original record count:", len(records))


def key(r):
    return (r.get("symbol"), r.get("trapType"), r.get("entryPrice"), r.get("exitPrice"),
            r.get("pnlUsd"), r.get("diagnostic"))


seen = {}
for r in records:
    k = key(r)
    # keep the EARLIEST occurrence of each unique diagnosis (when the lesson was first learned)
    if k not in seen or r.get("timestamp", "") < seen[k].get("timestamp", ""):
        seen[k] = r

deduped = sorted(seen.values(), key=lambda r: r.get("timestamp", ""))
print("Deduped record count:", len(deduped))
print("Removed:", len(records) - len(deduped))

with open(SRC, "w", encoding="utf-8") as f:
    json.dump(deduped, f, indent=2)

print("Wrote cleaned file:", SRC)
