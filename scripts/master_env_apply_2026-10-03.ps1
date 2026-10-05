# master_env_apply_2026-10-03.ps1 -- APPLY build_master_env.py (validates keys first). Writes config\master.env, fills only missing/placeholder names in .env (backup first).
# Report goes to a file; it shows names/lengths/status only. Afterwards prints a NAMES-ONLY verification (no values).
param([string]$Out = 'F:\aitradingagent\runs\2026-10-03_calibration\master_env_apply.txt')
Set-Location F:\aitradingagent
Remove-Item $Out -ErrorAction SilentlyContinue
& 'F:\aitradingagent\.venv\Scripts\python.exe' scripts\build_master_env.py --validate --max-validate 3 --apply *> $Out
"done, exit $LASTEXITCODE" | Add-Content $Out
