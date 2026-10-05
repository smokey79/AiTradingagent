# deploy_arb_2026-10-03.ps1 -- restart the two apps whose code changed (orchestrator: predictor + ATR fix; dashboard: arb routes),
# start the new paper-only arb-agent, and save the PM2 list. All apps keep the paper locks from ecosystem.demo.config.cjs.
Set-Location F:\aitradingagent
pm2 reload ecosystem.demo.config.cjs --only trading-orchestrator,dashboard --update-env
pm2 start ecosystem.demo.config.cjs --only arb-agent
pm2 save
Start-Sleep -Seconds 8
pm2 status
