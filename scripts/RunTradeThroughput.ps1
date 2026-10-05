node --check F:\aitradingagent\scripts\analyze-trade-throughput.js
if ($LASTEXITCODE -ne 0) { Write-Host "SYNTAX FAIL"; exit 1 }
node F:\aitradingagent\scripts\analyze-trade-throughput.js
