$out = "F:\aitradingagent\logs\llama32-usage.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8
Get-ChildItem -Path 'F:\aitradingagent\src','F:\aitradingagent\scripts' -Recurse -Include *.js,*.cjs,*.py -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Select-String -Pattern 'llama3\.2|llama3_2|llama-3\.2' |
  ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" } |
  Out-File $out -Append -Encoding utf8
if (-not (Test-Path $out) -or (Get-Item $out).Length -lt 50) {
  "NO REFERENCES FOUND to llama3.2 anywhere in src/ or scripts/" | Out-File $out -Append -Encoding utf8
}
