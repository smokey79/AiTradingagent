r"""
configure_freqtrade_dryrun_2026-10-03.py

Sets the Freqtrade DRY-RUN bridge up as the main calibration loop (dry_run stays true; nothing here can place a real order):
  * fee 0.0006 (0.06% per side)                      -> realism: costs from config/realism.json
  * entry/exit price_side "other"                    -> orders cross the spread (the dry-run equivalent of the 0.02% slippage)
  * 7 liquid pairs: BTC ETH SOL AVAX ARB OP LINK     -> inside the requested 5-7
  * dry_run_wallet 250, stake_amount 25              -> same 10% per trade as the earlier 1000/100 run, scaled to the real $250 account
  * max_open_trades stays 5; stoploss/ROI untouched  -> one variable at a time: only the strategy's tags change
Original is backed up in backups\2026-10-03_precalibration\. Re-runnable.
Run: F:\aitradingagent\.venv\Scripts\python.exe scripts\configure_freqtrade_dryrun_2026-10-03.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from core.realism import fee_pct_per_side  # noqa: E402

CFG = ROOT / "freqtrade-stable" / "user_data" / "config_bridge_dryrun.json"
cfg = json.loads(CFG.read_text(encoding="utf-8"))

assert cfg.get("dry_run") is True, "refusing to touch a config that is not dry_run"

changes = []


def setk(d, k, v, label):
    if d.get(k) != v:
        changes.append(f"{label}: {d.get(k)!r} -> {v!r}")
        d[k] = v


setk(cfg, "fee", round(fee_pct_per_side() / 100, 6), "fee")
setk(cfg["entry_pricing"], "price_side", "other", "entry_pricing.price_side")
setk(cfg["exit_pricing"], "price_side", "other", "exit_pricing.price_side")
setk(cfg["exchange"], "pair_whitelist",
     ["BTC/USDT", "ETH/USDT", "SOL/USDT", "AVAX/USDT", "ARB/USDT", "OP/USDT", "LINK/USDT"], "pair_whitelist")
setk(cfg, "dry_run_wallet", 250, "dry_run_wallet")
setk(cfg, "stake_amount", 25, "stake_amount")
# Fresh database for the calibration run. The old file (freqtrade_bridge_dryrun.sqlite) is kept untouched as the
# archive of the first 25 trades; it still holds 5 stale open positions that would otherwise fill all 5 trade slots
# and block every new trade. scripts/ledger_sync.py imports BOTH files.
setk(cfg, "db_url", "sqlite:///freqtrade_calibration_dryrun.sqlite", "db_url")

CFG.write_text(json.dumps(cfg, indent=4) + "\n", encoding="utf-8")
print("\n".join(changes) if changes else "no changes (already configured)")
print("dry_run =", cfg["dry_run"], "| strategy =", cfg.get("strategy"), "| pairs =", len(cfg["exchange"]["pair_whitelist"]))
