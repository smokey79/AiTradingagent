$ErrorActionPreference = 'SilentlyContinue'
Write-Output "=== trading-orchestrator ERROR log, last 150 lines ==="
Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-error.log" -Tail 150

Write-Output "`n=== trading-orchestrator OUT log, last 60 lines ==="
Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-out.log" -Tail 60
