$ErrorActionPreference = 'SilentlyContinue'
Write-Output "=== PM2 LIST ==="
pm2 jlist | ConvertFrom-Json | Select-Object name, pm_id, @{n='uptime_min';e={[math]::Round(((Get-Date) - (Get-Date '1970-01-01').AddMilliseconds($_.pm2_env.pm_uptime)).TotalMinutes,1)}}, @{n='restarts';e={$_.pm2_env.restart_time}}, @{n='mem_mb';e={[math]::Round($_.monit.memory/1MB,1)}} | Format-Table -AutoSize

Write-Output "`n=== trading-orchestrator: last 400 lines, ArbEngine Scan# lines only, with line numbers ==="
Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-out.log" -Tail 400 | Select-String -Pattern '\[ArbEngine\] Scan #' | ForEach-Object { $_.Line }

Write-Output "`n=== dashboard: last 200 lines, ArbEngine Scan# lines only (should be NONE) ==="
Get-Content "$env:USERPROFILE\.pm2\logs\dashboard-out.log" -Tail 200 | Select-String -Pattern '\[ArbEngine\] Scan #' | ForEach-Object { $_.Line }

Write-Output "`n=== dashboard: last 30 lines (confirm dashboard-only mode banner) ==="
Get-Content "$env:USERPROFILE\.pm2\logs\dashboard-out.log" -Tail 30
