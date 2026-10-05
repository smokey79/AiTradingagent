r"""
calib_inspect2_2026-10-03.py -- READ-ONLY deep look at agent_memory.db and the
freqtrade dry-run DB. Writes nothing. Run with the project venv python.
"""
import sqlite3, collections, statistics

ROOT = r"F:\aitradingagent"


def ro(rel):
    return sqlite3.connect("file:" + ROOT + "\\" + rel + "?mode=ro", uri=True)


def q(cur, sql):
    return cur.execute(sql).fetchall()


print("=== agent_memory.db / trades ===")
con = ro(r"data\agent_memory.db")
c = con.cursor()
print("range:", q(c, "select min(timestamp), max(timestamp), count(*) from trades")[0])
print("by action:", q(c, "select action, count(*) from trades group by 1"))
print("by signal_source:", q(c, "select signal_source, count(*), round(sum(pnl_usd),2) from trades group by 1 order by 2 desc limit 12"))
print("by llm_provider:", q(c, "select llm_provider, count(*) from trades group by 1 order by 2 desc limit 12"))
print("was_correct:", q(c, "select was_correct, count(*) from trades group by 1"))
print("pnl summary:", q(c, "select count(*), round(sum(pnl_usd),2), round(avg(pnl_pct),3), round(min(pnl_pct),2), round(max(pnl_pct),2) from trades where pnl_usd is not null"))
print("zero/NULL pnl:", q(c, "select sum(pnl_usd is null), sum(pnl_usd=0) from trades"))
print("distinct pnl values (dupe check):", q(c, "select count(distinct pnl_usd), count(*) from trades where pnl_usd is not null"))
print("top repeated pnl values:", q(c, "select pnl_usd, count(*) n from trades group by 1 order by n desc limit 6"))
print("top symbols:", q(c, "select symbol, count(*) from trades group by 1 order by 2 desc limit 10"))
print("top patterns:", q(c, "select pattern_name, count(*), round(avg(pnl_pct),3) from trades group by 1 order by 2 desc limit 10"))
print("by day:", q(c, "select substr(timestamp,1,10), count(*), round(sum(pnl_usd),2) from trades group by 1 order by 1 desc limit 10"))
print("sample rows:")
for r in q(c, "select trade_id,timestamp,symbol,action,size,entry_price,exit_price,pnl_usd,pnl_pct,hold_bars,pattern_name,signal_source,llm_provider,substr(decision_reason,1,70),was_correct from trades order by timestamp desc limit 4"):
    print("  ", r)
print("agent_weights:", q(c, "select * from agent_weights"))
print("profit_ledger cols:", [x[1] for x in q(c, "pragma table_info(profit_ledger)")])
print("profit_ledger sample:", q(c, "select * from profit_ledger order by rowid desc limit 2"))
print("learning_log cols:", [x[1] for x in q(c, "pragma table_info(learning_log)")])
con.close()

print("\n=== freqtrade dry-run / trades ===")
con = ro(r"freqtrade-stable\freqtrade_bridge_dryrun.sqlite")
c = con.cursor()
cols = [x[1] for x in q(c, "pragma table_info(trades)")]
print("has:", [x for x in ("enter_tag", "exit_reason", "strategy", "leverage", "is_short", "trading_mode") if x in cols])
sel = "pair,is_open,open_date,close_date,round(close_profit*100,2),round(close_profit_abs,2),stake_amount"
for x in ("enter_tag", "exit_reason", "is_short", "leverage"):
    if x in cols:
        sel += "," + x
rows = q(c, "select " + sel + " from trades order by open_date")
for r in rows:
    print("  ", r)
cl = [r for r in rows if r[1] == 0]
pp = [r[4] for r in cl]
print("closed:", len(cl), "wins:", sum(1 for p in pp if p > 0), "mean%:", round(statistics.mean(pp), 2), "median%:", round(statistics.median(pp), 2))
print("pairs:", collections.Counter(r[0] for r in rows))
print("date span:", rows[0][2], "->", rows[-1][2])
con.close()
print("\nDONE (read-only).")
