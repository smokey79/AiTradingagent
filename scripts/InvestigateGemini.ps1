Write-Host "=== .env GEMINI_DAILY_CALL_LIMIT (all occurrences, incl commented) ==="
Select-String -Path "F:\aitradingagent\.env" -Pattern "GEMINI_DAILY_CALL_LIMIT"

Write-Host ""
Write-Host "=== Actual env var each PM2 process was STARTED with ==="
foreach ($app in @('dashboard','trading-orchestrator')) {
    Write-Host "--- $app ---"
    pm2 env (pm2 id $app) 2>$null | Select-String "GEMINI_DAILY_CALL_LIMIT"
}

Write-Host ""
Write-Host "=== geminiAgent.js budget logic ==="
Select-String -Path "F:\aitradingagent\src\agents\geminiAgent.js" -Pattern "DAILY_CALL_LIMIT|count|budget|limit" | Select-Object -First 25
