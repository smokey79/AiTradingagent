Start-Sleep -Seconds 75
pm2 status
Write-Output "----LOGS----"
pm2 logs trading-orchestrator --lines 120 --nostream
