# duel_restart_b_check_2026-09-29.ps1 - restart only claude-solo, then verify the scoreboard on :3005 serves both bots
Set-Location F:\aitradingagent
pm2 restart claude-solo --update-env 2>&1 | Out-Null
Start-Sleep -Seconds 25
try {
  $j = (Invoke-WebRequest http://127.0.0.1:3005/api/duel -UseBasicParsing -TimeoutSec 10).Content | ConvertFrom-Json
  "Bot A equity: $($j.botA.equity)  trades: $($j.botA.trades)"
  "Bot B equity: $($j.botB.equity)  trades: $($j.botB.trades)  decisions: $($j.botB.decisionsMade)  spend: $($j.botB.spend)  ends: $($j.botB.endsAt)"
  $h = Invoke-WebRequest http://127.0.0.1:3005/ -UseBasicParsing -TimeoutSec 10
  "HTML page: HTTP $($h.StatusCode), $($h.Content.Length) bytes"
} catch { "scoreboard not reachable yet: $($_.Exception.Message)" }
Get-Content logs\claude-solo-out.log -Tail 6 | Where-Object { $_ -match 'ClaudeSolo' }
