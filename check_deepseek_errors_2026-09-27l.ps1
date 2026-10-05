$ErrorActionPreference = 'SilentlyContinue'
Write-Output "=== [DeepSeek] callDeepSeekRaw specific errors, last 4000 lines of OUT log ==="
Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-out.log" -Tail 4000 | Select-String '\[DeepSeek\] callDeepSeekRaw' | Select-Object -Last 20 | ForEach-Object { $_.Line }

Write-Output "`n=== Same search in ERROR log ==="
Get-Content "$env:USERPROFILE\.pm2\logs\trading-orchestrator-error.log" -Tail 4000 | Select-String '\[DeepSeek\] callDeepSeekRaw' | Select-Object -Last 20 | ForEach-Object { $_.Line }

Write-Output "`n=== Check DEEPSEEK_API_KEY presence (not value) ==="
Get-Content "F:\aitradingagent\.env" | Select-String '^DEEPSEEK_API_KEY' | ForEach-Object { $k = $_.Line -replace '=.+', '=<redacted, length ' + ($_.Line.Split('=')[1]).Length + '>'; $k }
