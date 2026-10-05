r"""
calibration_reset_2026-10-03.py

Archives (never deletes) the contaminated learning stores and resets learned weights to neutral.
  1. data\agent_memory.db  -> archived; a fresh DB with the SAME schema is created (empty trades,
     empty agent_weights = every weight falls back to the code's own neutral default, empty profit_ledger/sweep_log)
  2. data\won_trades_memory.json -> the FLASHLOAN "wins" are removed (archived), real entries kept
  3. data\channel_weights.json   -> reset to {} (it only held a weight learned from a test fixture)
  4. data\learning_memory.json   -> the test-fixture YouTube rows (Rick Astley video) archived and removed
Safe to re-run: it skips anything already clean. Writes a manifest next to the archive.
Run: F:\aitradingagent\.venv\Scripts\python.exe scripts\calibration_reset_2026-10-03.py
"""
import json, os, shutil, sqlite3, datetime, sys

ROOT = r"F:\aitradingagent"
DATA = os.path.join(ROOT, "data")
ARCH = os.path.join(ROOT, "runs", "2026-10-03_calibration", "archive", "contaminated_stores")
os.makedirs(ARCH, exist_ok=True)
manifest = {"at": datetime.datetime.now().isoformat(timespec="seconds"), "actions": []}


def note(msg, **kw):
    manifest["actions"].append({"msg": msg, **kw})
    print(msg)


# ---------------------------------------------------------------- 1. agent_memory.db
db = os.path.join(DATA, "agent_memory.db")
if os.path.exists(db):
    src = sqlite3.connect("file:" + db + "?mode=ro", uri=True)
    tables = [r[0] for r in src.execute("select name from sqlite_master where type='table' and name!='sqlite_sequence'")]
    counts = {t: src.execute(f'select count(*) from "{t}"').fetchone()[0] for t in tables}
    schema = [r[0] for r in src.execute("select sql from sqlite_master where sql is not null and name not like 'sqlite_%' order by case type when 'table' then 0 else 1 end")]
    arch_db = os.path.join(ARCH, "agent_memory.db")
    if os.path.exists(arch_db):
        arch_db = os.path.join(ARCH, "agent_memory.db." + datetime.datetime.now().strftime("%H%M%S"))
    dst = sqlite3.connect(arch_db)
    src.backup(dst)                                  # consistent copy, including any WAL content
    dst.close(); src.close()
    chk = sqlite3.connect("file:" + arch_db + "?mode=ro", uri=True)
    ok = all(chk.execute(f'select count(*) from "{t}"').fetchone()[0] == n for t, n in counts.items())
    chk.close()
    if not ok:
        note("ABORT: archive copy of agent_memory.db does not match source row counts; nothing changed")
        sys.exit(1)
    for ext in ("", "-wal", "-shm"):
        p = db + ext
        if os.path.exists(p):
            os.remove(p) if ext else None
    os.remove(db)
    fresh = sqlite3.connect(db)
    for stmt in schema:
        fresh.execute(stmt)
    fresh.execute("insert into learning_log (timestamp, event_type, detail) values (?,?,?)",
                  (datetime.datetime.now(datetime.timezone.utc).isoformat(), "calibration_reset",
                   "2026-10-03: contaminated trades/weights archived; weights neutral (code defaults)"))
    fresh.commit(); fresh.close()
    note("agent_memory.db archived and recreated empty", archived_to=arch_db, rows_archived=counts)
else:
    note("agent_memory.db not found (already moved?)")

# ---------------------------------------------------------------- 2. won_trades_memory.json
wp = os.path.join(DATA, "won_trades_memory.json")
w = json.load(open(wp, encoding="utf-8"))
bad = [e for e in w if str(e.get("side", "")).upper() == "FLASHLOAN"]
good = [e for e in w if e not in bad]
if bad:
    shutil.copy2(wp, os.path.join(ARCH, "won_trades_memory.before.json"))
    json.dump(bad, open(os.path.join(ARCH, "won_trades_memory.flashloan_removed.json"), "w", encoding="utf-8"), indent=2)
    json.dump(good, open(wp, "w", encoding="utf-8"), indent=2)
    note("won_trades_memory.json: flash-loan wins purged", removed=len(bad), kept=len(good))
else:
    note("won_trades_memory.json: no flash-loan entries present", kept=len(good))

# ---------------------------------------------------------------- 3. channel_weights.json
cp = os.path.join(DATA, "channel_weights.json")
cw = json.load(open(cp, encoding="utf-8"))
if cw:
    shutil.copy2(cp, os.path.join(ARCH, "channel_weights.before.json"))
    json.dump({}, open(cp, "w", encoding="utf-8"))
    note("channel_weights.json reset to neutral ({})", was=cw)

# ---------------------------------------------------------------- 4. learning_memory.json
lp = os.path.join(DATA, "learning_memory.json")
lm = json.load(open(lp, encoding="utf-8"))
fixture = [e for e in lm if e.get("videoId") == "dQw4w9WgXcQ" or e.get("channel") == "Rick Astley"]
rest = [e for e in lm if e not in fixture]
if fixture:
    shutil.copy2(lp, os.path.join(ARCH, "learning_memory.before.json"))
    json.dump(rest, open(lp, "w", encoding="utf-8"), indent=2)
    note("learning_memory.json: test-fixture rows removed", removed=len(fixture), kept=len(rest))

json.dump(manifest, open(os.path.join(ARCH, "MANIFEST.json"), "w", encoding="utf-8"), indent=2)
print("Archive:", ARCH)
