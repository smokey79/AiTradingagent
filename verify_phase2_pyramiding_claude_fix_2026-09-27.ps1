Write-Host "=== node --check: riskGate.js ==="
node --check "F:\aitradingagent\src\risk\riskGate.js"
Write-Host "=== node --check: consensus.js ==="
node --check "F:\aitradingagent\src\orchestrator\consensus.js"
Write-Host "=== node --check: claudeAgent.js ==="
node --check "F:\aitradingagent\src\agents\claudeAgent.js"
Write-Host "=== pm2 restart trading-orchestrator ==="
pm2 restart trading-orchestrator --update-env
Start-Sleep -Seconds 12
Write-Host "=== pm2 logs (last 50 lines) ==="
pm2 logs trading-orchestrator --lines 50 --nostream
