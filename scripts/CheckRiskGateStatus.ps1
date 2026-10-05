pm2 describe risk-gate | Select-String "status|restart|uptime|pid"
Write-Host ""
Write-Host "=== full log with timestamps (last 40) ==="
pm2 logs risk-gate --lines 40 --nostream --timestamp
