# reload_after_env_2026-10-03.ps1 -- reload the apps that read .env / the paper gate (orchestrator, dashboard, arb-agent) so they pick up the filled keys and the temporary 55% gate. Prints status only.
Set-Location F:\aitradingagent
pm2 reload ecosystem.demo.config.cjs --only trading-orchestrator,dashboard,arb-agent --update-env
pm2 save
Start-Sleep -Seconds 12
pm2 status
"--- dashboard route that exposes the gate value:"
Select-String -Path F:\aitradingagent\src\dashboard\server.js -Pattern 'minWinRateGate' -Context 6, 0 | Select-Object -First 1 | ForEach-Object { $_.Context.PreContext + $_.Line } | ForEach-Object { $_.Trim() }
