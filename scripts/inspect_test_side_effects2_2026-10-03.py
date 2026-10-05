r"""
inspect_test_side_effects2_2026-10-03.py -- READ-ONLY. Shows what the accidental full-suite test run
added to telegram_alpha.json / sentiment_memory.json and what git HEAD says allocation_settings was.
"""
import json, subprocess, os

ROOT = r"F:\aitradingagent"


def show(path):
    p = os.path.join(ROOT, path)
    with open(p, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()
    try:
        d = json.loads(raw)
    except Exception as e:
        print(path, "NOT JSON:", e, raw[:200]); return None
    return d


print("=== telegram_alpha.json")
d = show(r"data\telegram_alpha.json")
if d is not None:
    print("type:", type(d).__name__, "len:", len(d) if hasattr(d, "__len__") else "-")
    items = d if isinstance(d, list) else d.get("messages") or d.get("items") or []
    if isinstance(d, dict):
        print("keys:", list(d.keys())[:10])
    for it in items[-4:]:
        print(" ", json.dumps(it)[:260])

print("\n=== sentiment_memory.json")
d = show(r"data\sentiment_memory.json")
if d is not None:
    print("type:", type(d).__name__, "len:", len(d) if hasattr(d, "__len__") else "-")
    if isinstance(d, dict):
        print("keys:", list(d.keys())[:12])
        for k in list(d.keys())[:3]:
            print(" ", k, json.dumps(d[k])[:240])
    else:
        for it in d[-3:]:
            print(" ", json.dumps(it)[:240])

print("\n=== allocation_settings.json: current vs git HEAD")
print("current :", json.dumps(show(r"data\allocation_settings.json")))
out = subprocess.run(["git", "-C", ROOT, "show", "HEAD:data/allocation_settings.json"], capture_output=True, text=True)
print("git HEAD:", out.stdout.strip() or out.stderr.strip())

print("\n=== riskGate.js defaults for allocation settings")
for line in open(os.path.join(ROOT, r"src\risk\riskGate.js"), encoding="utf-8", errors="replace"):
    if "baseCurrency" in line or "defaultAllocationPct" in line or "memeAllocationPct" in line:
        print(" ", line.rstrip()[:200])
print("\nDONE (read-only).")
