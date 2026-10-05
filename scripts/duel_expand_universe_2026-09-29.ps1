# duel_expand_universe_2026-09-29.ps1 - widen the shared market list, then restart ONLY the two duel bots so both pick it up together
Set-Location F:\aitradingagent
node scripts\duel_expand_universe_2026-09-29.js
$ErrorActionPreference = 'Continue'
pm2 restart trading-orchestrator claude-solo --update-env 2>&1 | Out-Null
"both bots restarted $(Get-Date -Format HH:mm:ss) (balances/positions are saved state, so the duel continues)"
