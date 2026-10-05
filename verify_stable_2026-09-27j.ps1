Start-Sleep -Seconds 45
pm2 list 2>&1 | Out-String
Write-Output "---SCANS---"
Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-out.log" -Tail 15 | Select-String 'ArbEngine'
Write-Output "---WATCHDOG LOG (recent)---"
Get-Content "F:\aitradingagent\logs\watchdog.log" -Tail 10
