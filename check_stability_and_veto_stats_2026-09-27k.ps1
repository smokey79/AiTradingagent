$ErrorActionPreference = 'SilentlyContinue'
Write-Output "=== PM2 STATUS ==="
pm2 list 2>&1 | Out-String

Write-Output "`n=== Watchdog log, last 10 (confirm no more false-orphan kills) ==="
Get-Content "F:\aitradingagent\logs\watchdog.log" -Tail 10

Write-Output "`n=== trading-orchestrator OUT log, last 500 lines: Master Consensus outcome tally ==="
$lines = Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-out.log" -Tail 3000 | Select-String 'Master Consensus:'
Write-Output "Total consensus lines in tail: $($lines.Count)"
$lines | ForEach-Object { $_.Line } | Select-String -Pattern '\-> \S+ \S+/SKIPPED|\-> \S+ EXECUTED|-> \S+$' | Out-Null

# Classify outcomes
$executed = ($lines | Where-Object { $_.Line -match 'EXECUT' }).Count
$holdSkipped = ($lines | Where-Object { $_.Line -match 'HOLD/SKIPPED' }).Count
$other = $lines.Count - $executed - $holdSkipped
Write-Output "Executed: $executed | HOLD/SKIPPED: $holdSkipped | Other: $other"

Write-Output "`n=== Sample of skip reasons (Debate veto / Consensus skipped lines), last 3000 ==="
Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-out.log" -Tail 3000 | Select-String 'Consensus skipped:' | Select-Object -Last 20 | ForEach-Object { $_.Line }
