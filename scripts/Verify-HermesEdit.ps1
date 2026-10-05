$out = "F:\aitradingagent\logs\hermes-edit-verify.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8
& "F:\aitradingagent\venv\Scripts\python.exe" -c "print('n/a')" | Out-Null
node --check "F:\aitradingagent\src\agents\hermesAgent.js" 2>&1 | Out-File $out -Append -Encoding utf8
"exit code: $LASTEXITCODE" | Out-File $out -Append -Encoding utf8

"--- OPENROUTER_API_KEY present and not a placeholder? ---" | Out-File $out -Append -Encoding utf8
Set-Location F:\aitradingagent
$envLines = Get-Content .env | Where-Object { $_ -match '^OPENROUTER_API_KEY' -or $_ -match '^OPENROUTER_API_KEY_2' -or $_ -match '^OPENROUTER_API_KEY_3' }
foreach ($l in $envLines) {
  $k,$v = $l -split '=',2
  $masked = if ($v.Length -gt 8) { $v.Substring(0,6) + "..." + $v.Substring($v.Length-4) } else { "SHORT/EMPTY" }
  "$k = $masked (length $($v.Length))" | Out-File $out -Append -Encoding utf8
}
