Write-Host "=== autoTrader.js ==="
Select-String -Path "F:\aitradingagent\src\orchestrator\autoTrader.js" -Pattern "interval|setInterval|DEFAULT" | ForEach-Object { Write-Host "$($_.LineNumber): $($_.Line.Trim())" }
Write-Host ""
Write-Host "=== watchlist / symbols ==="
Select-String -Path "F:\aitradingagent\src\orchestrator\index.js" -Pattern "SYMBOLS|WATCHLIST|pairs|PAIRS" | ForEach-Object { Write-Host "$($_.LineNumber): $($_.Line.Trim())" }
Write-Host ""
Write-Host "=== cooldown / max trades per day ==="
Select-String -Path "F:\aitradingagent\src\risk\riskGate.js" -Pattern "cooldown|COOLDOWN|maxTradesPerDay|MAX_TRADES|tradesPerDay" | ForEach-Object { Write-Host "$($_.LineNumber): $($_.Line.Trim())" }
