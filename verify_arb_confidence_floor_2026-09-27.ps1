Write-Output '--- node --check continuousArbEngine.js ---'
node --check "F:\aitradingagent\src\arbitrage\continuousArbEngine.js"
Write-Output "exit: $LASTEXITCODE"

Write-Output '--- restarting trading-orchestrator (hosts the arb engine) ---'
pm2 restart trading-orchestrator --update-env

Start-Sleep -Seconds 8
pm2 list
