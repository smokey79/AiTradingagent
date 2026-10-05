$ErrorActionPreference = 'Continue'
$out = "F:\aitradingagent\logs\restart-trigger-search2.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8

$roots = @('F:\aitradingagent\src','F:\aitradingagent\scripts','F:\aitradingagent\bridge')
$patterns = "require\('pm2'\)|require\(`"pm2`"\)|process\.kill|SIGINT|totalmem|freemem|os\.cpus|taskkill|Stop-Process|memoryUsage|resourceMonitor|watchdog|Watchdog"

foreach ($root in $roots) {
  if (Test-Path $root) {
    "--- searching $root ---" | Out-File $out -Append -Encoding utf8
    Get-ChildItem -Path $root -Recurse -Include *.js,*.cjs,*.mjs,*.py,*.ps1 -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch 'node_modules' } |
      Select-String -Pattern $patterns |
      ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" } |
      Out-File $out -Append -Encoding utf8
  }
}

"--- all .ps1 files anywhere under F:\aitradingagent (not just scripts) ---" | Out-File $out -Append -Encoding utf8
Get-ChildItem -Path 'F:\aitradingagent' -Recurse -Include *.ps1 -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Select-Object -ExpandProperty FullName |
  Out-File $out -Append -Encoding utf8

"--- Windows Scheduled Tasks (all, not filtered) ---" | Out-File $out -Append -Encoding utf8
Get-ScheduledTask -ErrorAction SilentlyContinue |
  Where-Object { $_.TaskName -notmatch '^Microsoft' } |
  Select-Object TaskName, State |
  Out-File $out -Append -Encoding utf8
