$out = "F:\aitradingagent\logs\orch-health-check.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8
Set-Location F:\aitradingagent
"--- trading-orchestrator recent log (last 40) ---" | Out-File $out -Append -Encoding utf8
pm2 logs trading-orchestrator --lines 40 --nostream 2>&1 | Out-File $out -Append -Encoding utf8
