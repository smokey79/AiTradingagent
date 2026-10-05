pm2 restart trading-orchestrator 2>&1 | Out-String
Start-Sleep -Seconds 40
pm2 list 2>&1 | Out-String
Write-Output "---BEAR OUTCOMES (last 60s)---"
Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-out.log" -Tail 400 | Select-String '\[BearDebate\]|Bear debate veto|Consensus skipped:|Master Consensus:.*EXECUT'
