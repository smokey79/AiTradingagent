# verify_gate_and_agents_2026-10-03.ps1 -- READ-ONLY. After the reload: is the temporary 55% paper gate live, are the live gates untouched, and are the agents still falling back to heuristics?
param([int]$WaitSec = 120)
Start-Sleep -Seconds $WaitSec
$routes = 'http://localhost:3001/api/votes', 'http://localhost:3001/api/thresholds', 'http://localhost:3001/api/risk/config'
foreach ($u in $routes) {
  try { $r = Invoke-RestMethod -Uri $u -TimeoutSec 15; if ($r.thresholds) { "{0}: minConfidence={1} minWinRateGate={2}" -f $u, $r.thresholds.minConfidence, $r.thresholds.minWinRateGate; break } } catch { "{0}: {1}" -f $u, $_.Exception.Message.Split("`n")[0] }
}
"--- live gate (code default, from realism.json / .env): "
Select-String -Path F:\aitradingagent\config\realism.json -Pattern 'live_gate' | ForEach-Object { $_.Line.Trim() }
$log = "$env:USERPROFILE\.pm2\logs\trading-orchestrator-out.log"
$tail = Get-Content $log -Tail 1500
"--- since restart (last 1500 log lines): Heuristic-fallback mentions: " + @($tail | Select-String 'Heuristic fallback').Count + " | Master Consensus lines: " + @($tail | Select-String 'Master Consensus').Count + " | APPROVED: " + @($tail | Select-String 'APPROVED').Count + " | Predictor lines: " + @($tail | Select-String 'Predictor:').Count
"--- Risk Gate decisions (last 8):"
$tail | Select-String 'Risk Gate|Profitability Gate|win rate' | Select-Object -Last 8 | ForEach-Object { ($_.Line -replace '\x1b\[[0-9;]*m', '').Trim() }
"--- agents that errored or fell back (counts, last 1500 lines):"
$tail | ForEach-Object { ($_ -replace '\x1b\[[0-9;]*m', '') } | Select-String -Pattern 'fallback|unavailable|failed|401|402|403|429' | ForEach-Object { ($_.Line -replace '^\d\d:\d\d:\d\d\s+\S+\s*', '') -replace '\[[A-Z0-9]+/[A-Z0-9]+\]', '[PAIR]' -replace '\d+(\.\d+)?', 'N' } | Group-Object | Sort-Object Count -Descending | Select-Object -First 8 | ForEach-Object { "  {0,4}x  {1}" -f $_.Count, $_.Name.Substring(0, [Math]::Min(140, $_.Name.Length)) }
