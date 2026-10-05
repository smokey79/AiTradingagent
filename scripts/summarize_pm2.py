import json
with open(r"F:\aitradingagent\logs\pm2-jlist-fresh.json", encoding="utf-8-sig") as f:
    apps = json.load(f)
with open(r"F:\aitradingagent\logs\pm2-summary.txt", "w", encoding="utf-8") as out:
    for a in apps:
        env = a.get("pm2_env", {})
        out.write(f"{a.get('pm_id')} | {a.get('name')} | restarts={env.get('restart_time')} | "
                   f"script={env.get('pm_exec_path')} | created={env.get('created_at')} | "
                   f"cron={env.get('cron_restart')} | maxmem={env.get('max_memory_restart')}\n")
