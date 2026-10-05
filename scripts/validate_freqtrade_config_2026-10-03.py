r"""
validate_freqtrade_config_2026-10-03.py -- READ-ONLY. Loads the dry-run bridge config through Freqtrade's own loader and
JSON-schema validator and prints a short non-secret summary. Run with the Freqtrade venv python from freqtrade-stable:
    cd F:\aitradingagent\freqtrade-stable ; .venv\Scripts\python.exe ..\scripts\validate_freqtrade_config_2026-10-03.py
"""
from freqtrade.configuration import Configuration
from freqtrade.configuration.config_validation import validate_config_schema

cfg = Configuration.from_files(["user_data/config_bridge_dryrun.json"])
validate_config_schema(cfg)
assert cfg["dry_run"] is True, "dry_run must stay true"
print("config valid (Freqtrade schema)")
for k in ("dry_run", "dry_run_wallet", "stake_amount", "max_open_trades", "fee", "stoploss", "timeframe", "strategy", "db_url"):
    print(f"  {k} = {cfg.get(k)}")
print("  pairs:", ", ".join(cfg["exchange"]["pair_whitelist"]))
print("  entry price_side:", cfg["entry_pricing"]["price_side"], "| exit price_side:", cfg["exit_pricing"]["price_side"])
