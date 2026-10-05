# master_env_dryrun_2026-10-03.ps1 -- DRY RUN of build_master_env.py with key validation. Writes NOTHING except the report file. Report shows names/lengths/status only, never values.
param([string]$Out = 'F:\aitradingagent\runs\2026-10-03_calibration\master_env_dryrun.txt')
Set-Location F:\aitradingagent
Remove-Item $Out -ErrorAction SilentlyContinue
& 'F:\aitradingagent\.venv\Scripts\python.exe' scripts\build_master_env.py --validate --max-validate 3 *> $Out
"done, exit $LASTEXITCODE" | Add-Content $Out
