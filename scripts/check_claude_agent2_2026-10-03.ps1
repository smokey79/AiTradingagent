# check_claude_agent2_2026-10-03.ps1 -- READ-ONLY. Log lines stamped 23:xx today only (all after the reload). Did any Claude call succeed? Which agents still degrade?
$lines = Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-out.log" -Tail 6000 | ForEach-Object { ($_ -replace '\x1b\[[0-9;]*m', '').Trim() } | Where-Object { $_ -match '^23:' }
"lines stamped 23:xx: " + @($lines).Count + " (first " + ($lines | Select-Object -First 1).Substring(0, 8) + ", last " + ($lines | Select-Object -Last 1).Substring(0, 8) + ")"
$cl = $lines | Select-String '\[claude\s+\] ->'
"claude agent answers: total " + @($cl).Count + " | degraded " + @($cl | Where-Object { $_.Line -match 'DEGRADED' }).Count + " | healthy " + @($cl | Where-Object { $_.Line -match 'HEALTHY' }).Count
"claude call failures: " + @($lines | Select-String 'Claude API call failed').Count + " (timeouts: " + @($lines | Select-String 'Claude API call failed: timeout').Count + ")"
"--- other claude failure reasons:"
$lines | Select-String 'Claude API call failed' | Where-Object { $_.Line -notmatch 'timeout' } | Select-Object -First 3 | ForEach-Object { $_.Line }
"--- per-agent health tags (count):"
$lines | Select-String '^\S+ info: +\[(\w+)\s*\] ->.*\[(HEALTHY|DEGRADED)\]' | ForEach-Object { if ($_.Line -match '\[(\w+)\s*\] ->.*\[(HEALTHY|DEGRADED)\]') { $Matches[1] + ' ' + $Matches[2] } } | Group-Object | Sort-Object Name | ForEach-Object { "  {0,-28} {1}" -f $_.Name, $_.Count }
"--- orchestrator cycle timing (23:xx):"
$lines | Select-String 'CYCLE DONE' | Select-Object -Last 3 | ForEach-Object { $_.Line }
