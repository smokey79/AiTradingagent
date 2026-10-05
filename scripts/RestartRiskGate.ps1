pm2 restart risk-gate
Start-Sleep -Seconds 5
pm2 describe risk-gate | Select-String "status|restarts"
