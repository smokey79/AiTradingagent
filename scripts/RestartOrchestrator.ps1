pm2 restart trading-orchestrator
Start-Sleep -Seconds 10
pm2 describe trading-orchestrator | Select-String "status|restarts"
