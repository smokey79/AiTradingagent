Write-Host "=== mt5-feed entry point (ecosystem.config.cjs) ==="
Select-String -Path "F:\aitradingagent\ecosystem.config.cjs" -Pattern "mt5-feed|freqtrade-bridge" -Context 0,5

Write-Host ""
Write-Host "=== mt5Feed source, first 30 lines ==="
Get-ChildItem "F:\aitradingagent\src" -Recurse -Filter "*mt5*" | ForEach-Object { Write-Host $_.FullName }

Write-Host ""
Write-Host "=== freqtrade bridge source ==="
Get-ChildItem "F:\aitradingagent\src" -Recurse -Filter "*freqtrade*" | ForEach-Object { Write-Host $_.FullName }
