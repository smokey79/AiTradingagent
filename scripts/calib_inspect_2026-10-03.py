"""
calib_inspect_2026-10-03.py  --  READ-ONLY calibration inspection.
Purpose: summarise every real trade/decision record so we can see what data
exists for calibration. Writes nothing, changes nothing, prints a summary.
Run:  F:\aitradingagent\.venv\Scripts\python.exe scripts\calib_inspect_2026-10-03.py
"""
import json, sqlite3, collections, os, glob, datetime

ROOT = r"F:\aitradingagent"


def load(p):
    try:
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            return json.load(f)
    except Exception as e:
        return f"<unreadable: {e}>"


def hdr(t):
    print("\n=== " + t + " ===")


# 1. Duel decisions (claude-solo)
hdr("duel/claude_decisions.jsonl")
p = os.path.join(ROOT, "data", "duel", "claude_decisions.jsonl")
rows = []
for line in open(p, encoding="utf-8", errors="replace"):
    line = line.strip()
    if line:
        try:
            rows.append(json.loads(line))
        except Exception:
            pass
print("rows:", len(rows))
if rows:
    print("keys:", list(rows[0].keys()))
    acts = collections.Counter(str(r.get("action") or r.get("decision") or r.get("signal")) for r in rows)
    print("action counts:", dict(acts))
    print("first ts:", rows[0].get("ts") or rows[0].get("timestamp"), "last ts:", rows[-1].get("ts") or rows[-1].get("timestamp"))
    for r in rows[-3:]:
        print(json.dumps(r)[:500])

# 2. lost trades memory
hdr("lost_trades_memory.json")
d = load(os.path.join(ROOT, "data", "lost_trades_memory.json"))
if isinstance(d, list):
    print("entries:", len(d))
    print("sides:", dict(collections.Counter(x.get("side") for x in d)))
    print("trapTypes:", dict(collections.Counter(x.get("trapType") for x in d)))
    pnls = [x.get("pnlUsd") for x in d if isinstance(x.get("pnlUsd"), (int, float))]
    print("sum pnlUsd:", round(sum(pnls), 2), "n:", len(pnls))
    ts = sorted(x.get("timestamp", "") for x in d)
    print("range:", ts[0] if ts else None, "->", ts[-1] if ts else None)
else:
    print(d)

# 3. backtest evidence / summaries
for name in ["backtest_evidence.json", "backtest_summary.json", "backtest_summary_v2.json",
             "backtest_summary_1h.json", "backtest_3months_results.json", "backtest_simple_result.json"]:
    hdr(name)
    p = os.path.join(ROOT, "data", name)
    if not os.path.exists(p):
        p = os.path.join(ROOT, name)
    d = load(p)
    print(json.dumps(d)[:1800])

# 4. sqlite stores
for rel in [r"freqtrade-stable\freqtrade_bridge_dryrun.sqlite", r"data\agent_memory.db"]:
    hdr(rel)
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        print("missing"); continue
    try:
        con = sqlite3.connect("file:" + p + "?mode=ro", uri=True)
        cur = con.cursor()
        tabs = [r[0] for r in cur.execute("select name from sqlite_master where type='table'")]
        for t in tabs:
            n = cur.execute(f'select count(*) from "{t}"').fetchone()[0]
            print(f"  {t}: {n} rows")
        if "trades" in tabs:
            cols = [c[1] for c in cur.execute("pragma table_info(trades)")]
            print("  trades cols:", cols[:30])
            q = "select count(*), sum(case when close_profit>0 then 1 else 0 end), round(sum(close_profit_abs),2) from trades where is_open=0"
            print("  closed(n, wins, abs_profit):", cur.execute(q).fetchone())
        con.close()
    except Exception as e:
        print("  error:", e)

# 5. other trade-like files modified in last 7 days
hdr("recent files with 'trade' or 'ledger' in name (last 7d)")
cut = datetime.datetime.now().timestamp() - 7 * 86400
for p in glob.glob(os.path.join(ROOT, "**", "*"), recursive=True):
    if "node_modules" in p or ".venv" in p or "_archive" in p or ".git" + os.sep in p:
        continue
    b = os.path.basename(p).lower()
    if os.path.isfile(p) and ("trade" in b or "ledger" in b) and os.path.getmtime(p) > cut:
        print(f"  {p}  {os.path.getsize(p)}B  {datetime.datetime.fromtimestamp(os.path.getmtime(p)):%Y-%m-%d %H:%M}")
print("\nDONE (read-only).")
