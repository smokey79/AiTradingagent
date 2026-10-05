# duel_restart_both_check_2026-09-30.ps1 - restart ONLY the two duel bots together, then report what universe each sees
Set-Location F:\aitradingagent
$ErrorActionPreference = 'Continue'
pm2 restart trading-orchestrator claude-solo --update-env 2>&1 | Out-Null
"restarted $(Get-Date -Format HH:mm:ss)"
Start-Sleep -Seconds 50
Get-Content 'C:\Users\barcl\.pm2\logs\trading-orchestrator-out.log' -Tail 3000 | Select-String 'Universe: \d+ pairs' | Select-Object -Last 1 | ForEach-Object { 'Bot A: ' + $_.Line.Substring(0, [Math]::Min(95, $_.Line.Length)) }
Get-Content logs\claude-solo-out.log -Tail 40 | Select-String 'decision #|decision failed' | Select-Object -Last 1 | ForEach-Object { 'Bot B: ' + $_.Line.Substring(0, [Math]::Min(230, $_.Line.Length)) }
