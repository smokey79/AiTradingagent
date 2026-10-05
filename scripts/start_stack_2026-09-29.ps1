# start_stack_2026-09-29.ps1 - (re)start the PM2 stack from ecosystem.config.cjs and save it
Set-Location F:\aitradingagent
pm2 delete all 2>$null | Out-Null
pm2 start ecosystem.config.cjs --update-env
pm2 save
Start-Sleep -Seconds 45
pm2 jlist | ConvertFrom-Json | ForEach-Object { "{0,-22} {1,-9} restarts={2}" -f $_.name, $_.pm2_env.status, $_.pm2_env.restart_time }
try { $r = Invoke-WebRequest http://localhost:3001 -UseBasicParsing -TimeoutSec 10; "dashboard HTTP $($r.StatusCode)" } catch { "dashboard not up yet: $($_.Exception.Message)" }
