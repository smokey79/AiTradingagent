$ErrorActionPreference = "Continue"
Set-Location "F:\aitradingagent"
Write-Output "--- Before restart ---"
pm2 jlist | Out-File -FilePath "_pm2_before_debate_2026-09-27.json" -Encoding utf8

pm2 restart trading-orchestrator --update-env
Start-Sleep -Seconds 5

Write-Output "--- After restart (5s) ---"
pm2 jlist | Out-File -FilePath "_pm2_after_debate_2026-09-27.json" -Encoding utf8

Write-Output "--- Recent orchestrator logs ---"
pm2 logs trading-orchestrator --lines 40 --nostream
