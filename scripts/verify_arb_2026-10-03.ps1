# verify_arb_2026-10-03.ps1 -- READ-ONLY. After the deploy: are the arb agent, predictor and dashboard routes really working?
param([int]$WaitSec = 150)
Start-Sleep -Seconds $WaitSec
$pm2Logs = "$env:USERPROFILE\.pm2\logs"
"=== arb-agent log (last 12 lines)"
Get-Content "$pm2Logs\arb-agent-out.log" -Tail 12
"=== arb-agent errors (last 5)"
Get-Content "$pm2Logs\arb-agent-error.log" -Tail 5 -ErrorAction SilentlyContinue
"=== orchestrator: predictor + data-quality lines since restart (last 14 matches)"
Get-Content "$pm2Logs\trading-orchestrator-out.log" -Tail 600 | Select-String -Pattern 'Predictor|data-quality|CYCLE DONE|Master Consensus' | Select-Object -Last 14 | ForEach-Object { $_.Line.Trim() }
"=== dashboard endpoints"
foreach ($u in 'http://localhost:3001/arb.html', 'http://localhost:3001/api/arb/summary', 'http://localhost:3001/api/predictions/summary') {
  try { $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 15; "{0}  HTTP {1}  {2} bytes" -f $u, $r.StatusCode, $r.Content.Length } catch { "{0}  FAILED {1}" -f $u, $_.Exception.Message }
}
try {
  $s = Invoke-RestMethod -Uri 'http://localhost:3001/api/arb/summary' -TimeoutSec 15
  "arb: trades={0} netUsd={1} predictions total={2} scored={3} historyRows={4}" -f $s.pnl.trades, $s.pnl.netUsd, $s.predictor.total, $s.predictor.resolved, @($s.history).Count
  @($s.history) | Select-Object -First 6 | ForEach-Object { "  hist {0}: bars {1}, venues {2}, median gap {3}%, p90 {4}%, above-cost {5}" -f $_.symbol, $_.bars, $_.exchanges, $_.p50, $_.p90, $_.share_above_cost }
  $p = Invoke-RestMethod -Uri 'http://localhost:3001/api/predictions/summary' -TimeoutSec 15
  "trade predictions: total={0} scored={1} open={2}" -f $p.trade.total, $p.trade.resolved, $p.trade.open
} catch { "summary parse failed: " + $_.Exception.Message }
"=== host memory"
$os = Get-CimInstance Win32_OperatingSystem
"free {0:N1} GB of {1:N1} GB" -f ($os.FreePhysicalMemory / 1MB), ($os.TotalVisibleMemorySize / 1MB)
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 6 | ForEach-Object { "  {0,-28} {1,7:N0} MB" -f $_.ProcessName, ($_.WorkingSet64 / 1MB) }
