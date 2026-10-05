Write-Host "=== freqtrade-bridge / mt5-feed PM2 live status ==="
pm2 describe freqtrade-bridge | Select-String "status|restart|uptime"
pm2 describe mt5-feed | Select-String "status|restart|uptime"

Write-Host ""
Write-Host "=== recent freqtrade-bridge log ==="
pm2 logs freqtrade-bridge --lines 20 --nostream

Write-Host ""
Write-Host "=== recent mt5-feed log ==="
pm2 logs mt5-feed --lines 20 --nostream

Write-Host ""
Write-Host "=== is technical_lab/technical_daily wired to mt5MarketData or freqtrade? ==="
Select-String -Path "F:\aitradingagent\src\agents\technicalLabAgent.js","F:\aitradingagent\src\agents\technicalDailyAgent.js" -Pattern "mt5|freqtrade|oanda" -CaseSensitive:$false -ErrorAction SilentlyContinue
