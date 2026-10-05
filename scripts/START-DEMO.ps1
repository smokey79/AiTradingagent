# START-DEMO.ps1  (2026-10-03) -- one-click start of the PAPER / DEMO calibration build.
# Right-click > Run with PowerShell, or:  powershell -ExecutionPolicy Bypass -File F:\aitradingagent\scripts\START-DEMO.ps1
# Safe by design: refuses to start unless .env says paper mode, and every app gets paper-mode locks from
# ecosystem.demo.config.cjs. Nothing here can place a real order.
$ErrorActionPreference = 'Stop'
$root = 'F:\aitradingagent'
Set-Location $root
function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

Step '1/6 Preflight: paper-mode locks in .env (values of non-secret mode flags only)'
$flags = @{}
Get-Content "$root\.env" | ForEach-Object {
  if ($_ -match '^\s*(TRADING_MODE|PAPER_TRADING|LIVE_TRADING)\s*=\s*(.*)$') { $flags[$Matches[1]] = $Matches[2].Trim() }
}
$flags.GetEnumerator() | Sort-Object Name | ForEach-Object { "  {0} = {1}" -f $_.Name, $_.Value }
if ($flags['TRADING_MODE'] -ne 'paper' -or $flags['LIVE_TRADING'] -eq 'true' -or $flags['PAPER_TRADING'] -eq 'false') {
  throw 'STOP: .env is not in paper mode (need TRADING_MODE=paper, PAPER_TRADING=true, LIVE_TRADING=false). Fix .env first.'
}

Step '2/6 Preflight: tools'
node -v; & "$root\.venv\Scripts\python.exe" --version; pm2 -v

Step '3/6 Exchange minimum order sizes (public Bitget market info, no keys)'
node "$root\scripts\refresh_exchange_limits.js"

Step '4/6 Sync trade history into the single SQLite ledger'
& "$root\.venv\Scripts\python.exe" "$root\scripts\ledger_sync.py"

Step '5/6 Start the demo process set'
pm2 startOrReload "$root\ecosystem.demo.config.cjs" --update-env
pm2 save

Step '6/6 Status'
Start-Sleep -Seconds 8
pm2 status
Write-Host "`nDashboard: http://localhost:3001   |   Logs: pm2 logs trading-orchestrator   |   Stop: scripts\STOP-DEMO.ps1" -ForegroundColor Green
Write-Host "Calibration report any time: .venv\Scripts\python.exe scripts\calibration_report.py" -ForegroundColor Green
