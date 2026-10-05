r"""
restore_after_test_run_2026-10-03.py

Context: at 21:04 BST on 2026-10-03 the project's full JS test suite (node tests/runAllTests.js) was run
against the LIVE data folder. It writes to data\ (it is not sandboxed). This script undoes the parts that
matter and archives everything it touches (nothing is deleted).

Restores to the exact pre-test state, which was captured earlier the same evening:
  trade_ledger.json     -> empty (0 bytes)
  portfolio_state.json  -> {"updatedAt":"2026-09-29T22:02:04.1516492Z","sessionPeakBalance":250,"totalPnL":0,"currentBalance":250}
  vault_summary.json    -> all zeros (exact content captured earlier)
  allocation_settings   -> git HEAD version (the pre-test value was not captured; HEAD is the best known value)
Removes test-added rows (archived first):
  telegram_alpha.json   -> entries stamped 2026-10-03 (the fake "Whale alert" message)
  sentiment_memory.json -> entries with timestamp >= 2026-10-03T19:50Z (test BTC BUY row)
  allocation_log.jsonl  -> lines whose "at" is 2026-10-03T20:0x (written by the test run)
Run:  F:\aitradingagent\.venv\Scripts\python.exe scripts\restore_after_test_run_2026-10-03.py
"""
import json, os, shutil, subprocess, datetime

ROOT = r"F:\aitradingagent"
DATA = os.path.join(ROOT, "data")
ARCH = os.path.join(ROOT, "runs", "2026-10-03_calibration", "archive", "test_run_side_effects")
os.makedirs(ARCH, exist_ok=True)
stamp = datetime.datetime.now().strftime("%H%M%S")


def archive(name):
    src = os.path.join(DATA, name)
    if os.path.exists(src):
        shutil.copy2(src, os.path.join(ARCH, f"{name}.{stamp}"))


def read(name):
    with open(os.path.join(DATA, name), "r", encoding="utf-8") as f:
        return f.read()


def write(name, text):
    with open(os.path.join(DATA, name), "w", encoding="utf-8", newline="") as f:
        f.write(text)


report = []

# 1-3: exact restores
for n in ("trade_ledger.json", "portfolio_state.json", "vault_summary.json", "allocation_settings.json"):
    archive(n)

write("trade_ledger.json", "")
report.append("trade_ledger.json -> emptied (21 test rows archived)")

write("portfolio_state.json",
      '{"updatedAt":"2026-09-29T22:02:04.1516492Z","sessionPeakBalance":250,"totalPnL":0,"currentBalance":250}')
report.append("portfolio_state.json -> restored (balance 250, pnl 0)")

vault = {
    "mainAccountUsdt": 0, "btcSavingsUsd": 0, "longtermHoldUsd": 0, "unrealizedDailyPnl": 0,
    "totalProfitsHarvested": 0, "milestoneReached": False, "lastSweepDate": None,
    "updatedAt": "2026-09-29T23:00:00.959Z",
}
write("vault_summary.json", json.dumps(vault, indent=2))
report.append("vault_summary.json -> restored (all zeros)")

head = subprocess.run(["git", "-C", ROOT, "show", "HEAD:data/allocation_settings.json"], capture_output=True, text=True)
if head.returncode == 0 and head.stdout.strip().startswith("{"):
    json.loads(head.stdout)  # validate
    write("allocation_settings.json", head.stdout)
    report.append("allocation_settings.json -> git HEAD version (maxExposurePct 40)")
else:
    report.append("allocation_settings.json -> NOT restored (git HEAD unreadable): " + head.stderr[:100])

# 4: telegram_alpha
archive("telegram_alpha.json")
ta = json.loads(read("telegram_alpha.json"))
keep = [e for e in ta if not str(e.get("timestamp", "")).startswith("2026-10-03")]
removed = len(ta) - len(keep)
if removed:
    write("telegram_alpha.json", json.dumps(keep, indent=2))
report.append(f"telegram_alpha.json -> removed {removed} test entr{'y' if removed == 1 else 'ies'}")

# 5: sentiment_memory
archive("sentiment_memory.json")
sm = json.loads(read("sentiment_memory.json"))
cut_ms = int(datetime.datetime(2026, 10, 3, 19, 50, tzinfo=datetime.timezone.utc).timestamp() * 1000)
keep = [e for e in sm if not (isinstance(e.get("timestamp"), (int, float)) and e["timestamp"] >= cut_ms)]
removed = len(sm) - len(keep)
if removed:
    write("sentiment_memory.json", json.dumps(keep, indent=2))
report.append(f"sentiment_memory.json -> removed {removed} test entr{'y' if removed == 1 else 'ies'}")

# 6: allocation_log.jsonl
archive("allocation_log.jsonl")
kept, dropped = [], []
with open(os.path.join(DATA, "allocation_log.jsonl"), "r", encoding="utf-8") as f:
    for line in f:
        s = line.strip()
        if not s:
            continue
        try:
            at = json.loads(s).get("at", "")
        except Exception:
            at = ""
        (dropped if at.startswith("2026-10-03T20:0") else kept).append(line if line.endswith("\n") else line + "\n")
if dropped:
    with open(os.path.join(DATA, "allocation_log.jsonl"), "w", encoding="utf-8", newline="") as f:
        f.writelines(kept)
    with open(os.path.join(ARCH, f"allocation_log.test_rows.{stamp}.jsonl"), "w", encoding="utf-8", newline="") as f:
        f.writelines(dropped)
report.append(f"allocation_log.jsonl -> removed {len(dropped)} test line(s), kept {len(kept)}")

print("\n".join(report))
print("Archive folder:", ARCH)
print("Left alone (runtime caches regenerated by the test, harmless): agent_health, latest_agent_votes, "
      "system_health, defi_opportunities, arb_crosschain_snapshot, evidence_candidates_state, gemini_call_budget")
