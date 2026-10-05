# diag_watchdog_2026-10-03.ps1 -- READ-ONLY. What does the "AiTradingAgent Watchdog" scheduled task do?
$t = Get-ScheduledTask -TaskName 'AiTradingAgent Watchdog' -ErrorAction SilentlyContinue
if ($t) {
  "State: $($t.State)"
  "Actions:"; $t.Actions | ForEach-Object { "  $($_.Execute) $($_.Arguments)" }
  "Triggers:"; $t.Triggers | ForEach-Object { "  $($_.CimClass.CimClassName) repetition=$($_.Repetition.Interval) enabled=$($_.Enabled)" }
  $i = Get-ScheduledTaskInfo -TaskName 'AiTradingAgent Watchdog'
  "LastRun: $($i.LastRunTime)  LastResult: $($i.LastTaskResult)  NextRun: $($i.NextRunTime)"
} else { "task not found" }
"--- watchdog.log tail"
Get-Content F:\aitradingagent\logs\watchdog.log -Tail 14
"--- BITGET demo key presence (names only, never values)"
foreach ($k in 'BITGET_DEMO_ENABLED','BITGET_DEMO_API_KEY','BITGET_DEMO_SECRET','BITGET_DEMO_PASSPHRASE','OPENROUTER_API_KEY','BIGDATA_API_KEY','TELEGRAM_API_ID','TELEGRAM_SESSION') {
  $line = Get-Content F:\aitradingagent\.env | Where-Object { $_ -match "^\s*$k\s*=" } | Select-Object -First 1
  if ($null -eq $line) { "{0,-26} not present" -f $k }
  else { $v = ($line -split '=',2)[1].Trim(); if ($k -eq 'BITGET_DEMO_ENABLED') { "{0,-26} = {1}" -f $k,$v } else { "{0,-26} {1}" -f $k, $(if ($v.Length -gt 0) { "set (length $($v.Length))" } else { "EMPTY" }) } }
}
