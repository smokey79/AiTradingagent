Set-Location F:\aitradingagent
Write-Output '--- restarting risk-gate ---'
pm2 restart risk-gate --update-env
Start-Sleep -Seconds 3
Write-Output '--- restarting dashboard ---'
pm2 restart dashboard --update-env
Start-Sleep -Seconds 3
Write-Output '--- restarting trading-orchestrator ---'
pm2 restart trading-orchestrator --update-env
Start-Sleep -Seconds 3
Write-Output '--- status ---'
pm2 jlist | Out-File -FilePath F:\aitradingagent\_pm2_status_2026-09-27.json -Encoding utf8
Write-Output 'DONE'
