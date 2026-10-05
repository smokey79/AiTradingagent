Write-Output '--- node --check riskGate.js ---'
node --check "F:\aitradingagent\src\risk\riskGate.js"
Write-Output "exit: $LASTEXITCODE"

Write-Output '--- restarting affected PM2 processes ---'
pm2 restart trading-orchestrator dashboard risk-gate --update-env

Start-Sleep -Seconds 8

Write-Output '--- pm2 list ---'
pm2 list

Write-Output '--- trading-orchestrator recent logs ---'
pm2 logs trading-orchestrator --lines 40 --nostream
