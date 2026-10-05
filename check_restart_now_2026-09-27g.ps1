pm2 list 2>&1 | Out-String
Write-Output "---"
Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-error.log" -Tail 20
