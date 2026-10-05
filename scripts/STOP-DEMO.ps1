# STOP-DEMO.ps1 (2026-10-03) -- stops the demo process set started by START-DEMO.ps1 (does not delete anything).
$names = 'trading-orchestrator','dashboard','freqtrade-bridge','bigdata-analyst','telegram-listener','ledger-sync'
foreach ($n in $names) { pm2 stop $n 2>&1 | Out-Null }
pm2 save | Out-Null
pm2 status
"Stopped. Data is untouched. Start again with scripts\START-DEMO.ps1"
