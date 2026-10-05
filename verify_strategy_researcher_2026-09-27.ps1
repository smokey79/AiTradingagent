Set-Location "F:\aitradingagent"
Write-Host "=== node --check strategyResearcher.js ==="
node --check src\agents\strategyResearcher.js
Write-Host "=== node --check riskGate.js ==="
node --check src\risk\riskGate.js
Write-Host "=== restarting trading-orchestrator ==="
pm2 restart trading-orchestrator --update-env
Start-Sleep -Seconds 10
Write-Host "=== recent logs ==="
pm2 logs trading-orchestrator --lines 40 --nostream
