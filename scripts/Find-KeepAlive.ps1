$out = "F:\aitradingagent\logs\keepalive-usage.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8
Get-ChildItem -Path 'F:\aitradingagent\src','F:\aitradingagent\scripts' -Recurse -Include *.js,*.cjs,*.py -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Select-String -Pattern 'keep_alive|keepAlive|KEEP_ALIVE' |
  ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" } |
  Out-File $out -Append -Encoding utf8
"--- current OLLAMA_KEEP_ALIVE env var (system-wide) ---" | Out-File $out -Append -Encoding utf8
[Environment]::GetEnvironmentVariable('OLLAMA_KEEP_ALIVE','Machine') | Out-File $out -Append -Encoding utf8
[Environment]::GetEnvironmentVariable('OLLAMA_KEEP_ALIVE','User') | Out-File $out -Append -Encoding utf8
