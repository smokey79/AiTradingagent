$out = "F:\aitradingagent\logs\hermes-wiring.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8
Select-String -Path "F:\aitradingagent\src\orchestrator\consensus.js" -Pattern "hermes" -CaseSensitive:$false |
  ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" } | Out-File $out -Append -Encoding utf8
