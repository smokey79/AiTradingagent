# health_2026-09-29.ps1 - quick health snapshot: restarts, last log lines per key process, RAM, ledger count
$pm2logs = "C:\Users\barcl\.pm2\logs"
pm2 ls --no-color | Select-String -Pattern 'online|errored|stopped'
$os = Get-CimInstance Win32_OperatingSystem
"RAM free: {0:N1} GB of {1:N1} GB" -f ($os.FreePhysicalMemory/1MB), ($os.TotalVisibleMemorySize/1MB)
foreach ($n in 'trading-orchestrator-out','trading-orchestrator-error') {
  $f = Join-Path $pm2logs "$n.log"
  if (Test-Path $f) { "=== $n (last 25) ==="; Get-Content $f -Tail 25 }
}
foreach ($n in 'debate-err','arb-scanner-err','bigdata-analyst-err','hermes-analyst-err','mt5-feed-err') {
  $f = "F:\aitradingagent\logs\$n.log"
  if (Test-Path $f) { "=== $n (last 4) ==="; Get-Content $f -Tail 4 }
}
$l = "F:\aitradingagent\data\trade_ledger.json"
"ledger lines: " + @(Get-Content $l | Where-Object { $_.Trim() }).Count
"portfolio: " + (Get-Content F:\aitradingagent\data\portfolio_state.json -Raw)
