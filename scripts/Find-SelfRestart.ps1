$ErrorActionPreference = 'Continue'
$out = "F:\aitradingagent\logs\self-restart-search.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8

$files = @(
  'F:\aitradingagent\scripts\hermes_analyst.py',
  'F:\aitradingagent\src\flashloan\arbitrage_scanner.py',
  'F:\aitradingagent\scripts\mt5_market_feed.py',
  'F:\aitradingagent\scripts\debate_runner.py'
)

foreach ($f in $files) {
  "--- $f ---" | Out-File $out -Append -Encoding utf8
  if (Test-Path $f) {
    Select-String -Path $f -Pattern 'pm2|subprocess|os\.system|restart|Popen|sys\.exit' |
      ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" } |
      Out-File $out -Append -Encoding utf8
  } else {
    "NOT FOUND" | Out-File $out -Append -Encoding utf8
  }
}

"--- last 15 lines of each err log ---" | Out-File $out -Append -Encoding utf8
$errlogs = @(
  'F:\aitradingagent\logs\hermes-analyst-err.log',
  'F:\aitradingagent\logs\arb-scanner-err.log',
  'F:\aitradingagent\logs\mt5-feed-err.log',
  'F:\aitradingagent\logs\debate-err.log'
)
foreach ($el in $errlogs) {
  "--- $el ---" | Out-File $out -Append -Encoding utf8
  if (Test-Path $el) {
    Get-Content $el -Tail 15 | Out-File $out -Append -Encoding utf8
  } else {
    "NOT FOUND" | Out-File $out -Append -Encoding utf8
  }
}
