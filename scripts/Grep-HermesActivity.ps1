$out = "F:\aitradingagent\logs\hermes-activity.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8
Set-Location F:\aitradingagent
Start-Sleep -Seconds 20
pm2 logs trading-orchestrator --lines 400 --nostream 2>&1 | Select-String -Pattern "hermes" -CaseSensitive:$false |
  Out-File $out -Append -Encoding utf8
