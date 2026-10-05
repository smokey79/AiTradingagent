$out = "F:\aitradingagent\logs\hermes-restart-verify.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8
Set-Location F:\aitradingagent
pm2 restart trading-orchestrator --update-env 2>&1 | Out-File $out -Append -Encoding utf8
Start-Sleep -Seconds 15
"--- pm2 list (trading-orchestrator row) ---" | Out-File $out -Append -Encoding utf8
pm2 list 2>&1 | Select-String "trading-orchestrator" | Out-File $out -Append -Encoding utf8
"--- recent log, watching for hermes activity ---" | Out-File $out -Append -Encoding utf8
pm2 logs trading-orchestrator --lines 30 --nostream 2>&1 | Out-File $out -Append -Encoding utf8
