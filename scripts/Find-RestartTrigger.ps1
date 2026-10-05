$ErrorActionPreference = 'Continue'
$out = "F:\aitradingagent\logs\restart-trigger-search.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8

$roots = @('F:\aitradingagent\src','F:\aitradingagent\scripts','F:\aitradingagent\bridge')
$patterns = 'pm2\.restart|pm2 restart|pm2\.reload|pm2 reload|node-cron|cron\.schedule|execSync.*pm2|spawn.*pm2'

foreach ($root in $roots) {
  if (Test-Path $root) {
    "--- searching $root ---" | Out-File $out -Append -Encoding utf8
    Get-ChildItem -Path $root -Recurse -Include *.js,*.cjs,*.mjs,*.py -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch 'node_modules' } |
      Select-String -Pattern $patterns |
      ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" } |
      Out-File $out -Append -Encoding utf8
  }
}
