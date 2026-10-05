# duel_precheck_2026-09-29.ps1 - read-only: PM2 state, relevant .env flags (names/booleans only, secrets masked), RAM, data file ages
Set-Location F:\aitradingagent
"=== PM2 ==="; pm2 ls --no-color | Select-String 'online|errored|stopped'
$os = Get-CimInstance Win32_OperatingSystem
"RAM free: {0:N1} GB of {1:N1} GB" -f ($os.FreePhysicalMemory/1MB), ($os.TotalVisibleMemorySize/1MB)
"=== .env (masked) ==="
Get-Content .env | Where-Object { $_ -match '^(ANTHROPIC[A-Z_]*|CLAUDE[A-Z_]*|ALPACA[A-Z_]*|OANDA[A-Z_]*|PAPER_TRADING|NO_TRADES|EXECUTION_ENABLED|INITIAL_DEPOSIT|LEVERAGE_MAX|MIN_MARGIN_BALANCE_USD|MEME[A-Z_]*|MIN_CONFIDENCE)=' } |
  ForEach-Object { $k,$v = $_ -split '=',2; if ($k -match 'KEY|SECRET|TOKEN|PASS|ACCOUNT') { "$k=" + $(if ($v.Trim()) {'<set>'} else {'<EMPTY>'}) } else { "$k=$v" } }
"=== ledger / portfolio ==="
"ledger lines: " + @(Get-Content data\trade_ledger.json | Where-Object { $_.Trim() }).Count
Get-Content data\portfolio_state.json
"=== last orchestrator log line ==="
Get-Content 'C:\Users\barcl\.pm2\logs\trading-orchestrator-out.log' -Tail 1
