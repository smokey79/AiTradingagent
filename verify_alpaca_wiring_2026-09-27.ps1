Write-Host "=== node --check: instrumentUniverse.js ==="
node --check "F:\aitradingagent\src\utils\instrumentUniverse.js"
Write-Host "=== node --check: alpacaMarketData.js ==="
node --check "F:\aitradingagent\src\data\alpacaMarketData.js"
Write-Host "=== node --check: alpacaExecutor.js ==="
node --check "F:\aitradingagent\src\utils\alpacaExecutor.js"
Write-Host "=== node --check: orchestrator/index.js ==="
node --check "F:\aitradingagent\src\orchestrator\index.js"
Write-Host "=== JSON validate: instrument_universe.json ==="
node -e "JSON.parse(require('fs').readFileSync('F:\\aitradingagent\\config\\instrument_universe.json','utf8')); console.log('valid JSON')"
Write-Host "=== pm2 restart trading-orchestrator ==="
pm2 restart trading-orchestrator --update-env
Start-Sleep -Seconds 12
Write-Host "=== pm2 logs (last 40 lines) ==="
pm2 logs trading-orchestrator --lines 40 --nostream
