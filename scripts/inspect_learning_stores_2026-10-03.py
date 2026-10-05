r"""inspect_learning_stores_2026-10-03.py -- READ-ONLY look at other learned-state files to decide what is contaminated."""
import json, os, sqlite3

D = r"F:\aitradingagent\data"
for name in ["learning_agent_state.json", "learning_memory.json", "channel_weights.json", "learned_strategies.json",
             "agent_account_ledger.json", "nexo_btc_sweeper_ledger.json", "hermes_deep_analysis.json", "allocation_settings.json"]:
    p = os.path.join(D, name)
    print("\n=====", name, os.path.getsize(p) if os.path.exists(p) else "MISSING", "bytes")
    if not os.path.exists(p):
        continue
    try:
        d = json.load(open(p, encoding="utf-8", errors="replace"))
    except Exception as e:
        print("  not json:", e); continue
    if isinstance(d, dict):
        print("  keys:", list(d.keys())[:14])
        print("  ", json.dumps(d)[:420])
    else:
        print("  list len", len(d), json.dumps(d[:2])[:420])

p = os.path.join(D, "trading.db")
print("\n===== trading.db", os.path.getsize(p) if os.path.exists(p) else "MISSING")
if os.path.exists(p):
    con = sqlite3.connect("file:" + p + "?mode=ro", uri=True)
    for (t,) in con.execute("select name from sqlite_master where type='table'"):
        print("  ", t, con.execute(f'select count(*) from "{t}"').fetchone()[0])
    con.close()

sp = os.path.join(r"F:\aitradingagent\strategy", "strategy_memory.json")
print("\n===== strategy_memory.json", os.path.getsize(sp))
d = json.load(open(sp, encoding="utf-8", errors="replace"))
print("  ", json.dumps(d)[:500])
print("\nDONE (read-only).")
