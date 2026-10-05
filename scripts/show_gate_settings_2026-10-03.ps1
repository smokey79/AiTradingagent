# show_gate_settings_2026-10-03.ps1 -- READ-ONLY. Prints ONLY non-secret threshold/gate lines from .env (key name patterns below); never prints any other line.
$p = 'F:\aitradingagent\.env'
$pat = '^(\s*#\s*)?[A-Z0-9_]*(CONFIDENCE|GATE|THRESH|WIN_RATE|HIT_RATE|PROBAB|MIN_TRADES|MIN_AGENTS|MAJORITY|TRADING_MODE|PAPER|LIVE|ARB_MODE|SAMPLE)[A-Z0-9_]*\s*='
Get-Content $p | Where-Object { $_ -match $pat } | ForEach-Object { $_.Trim() }
"--- other places a 62 / 0.62 could be set (non-.env):"
Get-ChildItem F:\aitradingagent -Recurse -File -Include *.json,*.yaml,*.yml,*.toml -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules|\\\.venv|\\venv|\\backups|\\runs\\|\\logs\\|package-lock|freqtrade-stable\\\.venv|\\dist\\|\\build\\' -and $_.Length -lt 400KB } |
  Select-String -Pattern '"[A-Za-z_]*(win_?rate|hit_?rate|confidence|probability|threshold)[A-Za-z_]*"\s*:\s*(0?\.62|62)\b' -ErrorAction SilentlyContinue |
  Select-Object -First 15 | ForEach-Object { "{0}:{1}: {2}" -f $_.Path.Replace('F:\aitradingagent\', ''), $_.LineNumber, $_.Line.Trim().Substring(0, [Math]::Min(120, $_.Line.Trim().Length)) }
