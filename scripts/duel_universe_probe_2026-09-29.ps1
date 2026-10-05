# duel_universe_probe_2026-09-29.ps1 - runs the read-only market probe and saves its output
Set-Location F:\aitradingagent
node scripts\duel_universe_probe_2026-09-29.js 2>&1 | Where-Object { $_ -match '^(CRYPTO|OANDA|NOT)' } | Out-File -Encoding utf8 runs\2026-09-29_duel\universe_probe.log
"done"
