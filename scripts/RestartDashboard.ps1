pm2 restart dashboard
Start-Sleep -Seconds 5
pm2 describe dashboard | Select-String "status|restarts"
