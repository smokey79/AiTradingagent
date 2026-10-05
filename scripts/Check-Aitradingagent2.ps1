$ErrorActionPreference = 'Continue'
$out = "F:\aitradingagent\logs\aitradingagent2-check.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8

"--- top-level listing of F:\aitradingagent2 ---" | Out-File $out -Append -Encoding utf8
Get-ChildItem -Path 'F:\aitradingagent2' -ErrorAction SilentlyContinue |
  Select-Object Name, Mode, LastWriteTime |
  Out-File $out -Append -Encoding utf8

"--- any ecosystem config files ---" | Out-File $out -Append -Encoding utf8
Get-ChildItem -Path 'F:\aitradingagent2' -Recurse -Include 'ecosystem*.cjs','ecosystem*.js','ecosystem*.json' -File -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty FullName | Out-File $out -Append -Encoding utf8

"--- any Watchdog*.ps1 files ---" | Out-File $out -Append -Encoding utf8
Get-ChildItem -Path 'F:\aitradingagent2' -Recurse -Include 'Watchdog*.ps1','*watchdog*.ps1' -File -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty FullName | Out-File $out -Append -Encoding utf8

"--- any script referencing arb-scanner/hermes-analyst/mt5-feed/python-debate ---" | Out-File $out -Append -Encoding utf8
Get-ChildItem -Path 'F:\aitradingagent2' -Recurse -Include *.ps1,*.js,*.cjs,*.py -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Select-String -Pattern 'arb-scanner|hermes-analyst|mt5-feed|python-debate' |
  ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" } |
  Out-File $out -Append -Encoding utf8
