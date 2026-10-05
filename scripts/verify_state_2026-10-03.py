r"""verify_state_2026-10-03.py -- READ-ONLY end-state check of the data stores after the calibration reset."""
import json, os, sqlite3, datetime
D = r"F:\aitradingagent\data"

def size(p): return os.path.getsize(os.path.join(D, p)) if os.path.exists(os.path.join(D, p)) else None

print("trade_ledger.json bytes:", size("trade_ledger.json"), "(0 = empty, as before the accidental test run)")
print("portfolio_state.json:", open(os.path.join(D, "portfolio_state.json")).read().strip())
v = json.load(open(os.path.join(D, "vault_summary.json")))
print("vault_summary: btcSavingsUsd", v["btcSavingsUsd"], "longtermHoldUsd", v["longtermHoldUsd"], "totalProfitsHarvested", v["totalProfitsHarvested"])
print("allocation_settings:", json.dumps(json.load(open(os.path.join(D, "allocation_settings.json")))))

w = json.load(open(os.path.join(D, "won_trades_memory.json")))
print("won_trades_memory: entries", len(w), "| sides", sorted({e["side"] for e in w}), "| any FLASHLOAN:", any(e["side"] == "FLASHLOAN" for e in w))
print("channel_weights:", open(os.path.join(D, "channel_weights.json")).read().strip())
print("learning_memory entries:", len(json.load(open(os.path.join(D, "learning_memory.json")))))
print("lost_trades_memory entries:", len(json.load(open(os.path.join(D, "lost_trades_memory.json")))))

con = sqlite3.connect("file:" + os.path.join(D, "agent_memory.db") + "?mode=ro", uri=True)
print("\nagent_memory.db (fresh):")
for (t,) in con.execute("select name from sqlite_master where type='table' and name!='sqlite_sequence'"):
    print(f"  {t}: {con.execute(f'select count(*) from {t}').fetchone()[0]} rows")
print("  learning_log:", con.execute("select event_type, detail from learning_log").fetchall())
con.close()

arch = r"F:\aitradingagent\runs\2026-10-03_calibration\archive"
print("\narchived files:")
for root, _, files in os.walk(arch):
    for f in files:
        p = os.path.join(root, f)
        print(f"  {os.path.relpath(p, arch)}  {os.path.getsize(p)} bytes")
src = sqlite3.connect("file:" + os.path.join(arch, "contaminated_stores", "agent_memory.db") + "?mode=ro", uri=True)
print("\narchived agent_memory.db row counts:", {t: src.execute(f'select count(*) from {t}').fetchone()[0] for (t,) in src.execute("select name from sqlite_master where type='table' and name!='sqlite_sequence'")})
src.close()
