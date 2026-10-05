# check_claude_agent_2026-10-03.ps1 -- READ-ONLY. Only log lines AFTER the 22:59:45 reload: is the Claude agent now using its key, and why does it time out?
$strip = { param($s) ($s -replace '\x1b\[[0-9;]*m', '').Trim() }
$lines = Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-out.log" -Tail 4000 | ForEach-Object { & $strip $_ }
$post = $lines | Where-Object { $_ -match '^(\d\d):(\d\d):(\d\d)' -and (([int]$Matches[1] * 3600 + [int]$Matches[2] * 60 + [int]$Matches[3]) -ge (22 * 3600 + 59 * 60 + 45) -or [int]$Matches[1] -lt 6) }
"post-reload lines: " + @($post).Count
"no-key fallback: " + @($post | Select-String 'no Claude API key').Count + " | claude timeouts: " + @($post | Select-String 'Claude API call failed').Count + " | claude real answers: " + @($post | Select-String '\[claude\s+\] -> (BUY|SELL|HOLD)' | Where-Object { $_.Line -notmatch 'DEGRADED' }).Count
$post | Select-String 'Claude API call failed' | Select-Object -First 2 | ForEach-Object { $_.Line }
"--- how the Claude agent reads its key and sets its timeout (lines only):"
Select-String -Path F:\aitradingagent\src\agents\claudeAgent.js -Pattern 'API_KEY|timeout|model:|MODEL|baseURL|anthropic' | Select-Object -First 14 | ForEach-Object { "{0}: {1}" -f $_.LineNumber, ($_.Line.Trim().Substring(0, [Math]::Min(130, $_.Line.Trim().Length))) }
"--- the gate value each running app really has (only these variables are read):"
$js = "$env:TEMP\pm2_gate_probe.js"
Set-Content $js "const {execSync}=require('child_process');const l=JSON.parse(execSync('pm2 jlist',{maxBuffer:1e8}).toString());for(const a of l){console.log(a.name.padEnd(22),'RISK_MIN_WIN_RATE_GATE=',a.pm2_env.RISK_MIN_WIN_RATE_GATE,'| ARB_MODE=',a.pm2_env.ARB_MODE,'| TRADING_MODE=',a.pm2_env.TRADING_MODE)}"
node $js
