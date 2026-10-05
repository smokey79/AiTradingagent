$ErrorActionPreference = 'Continue'
$apps = @('hermes-analyst','arb-scanner','mt5-feed','python-debate')
$out = "F:\aitradingagent\logs\cron-diagnose.txt"
"=== $(Get-Date) ===" | Out-File $out -Encoding utf8

foreach ($app in $apps) {
  "--- pm2 describe $app ---" | Out-File $out -Append -Encoding utf8
  pm2 describe $app 2>&1 | Out-File $out -Append -Encoding utf8
  "" | Out-File $out -Append -Encoding utf8
}

"--- dump.pm2 cron/interval search ---" | Out-File $out -Append -Encoding utf8
$dump = "$env:USERPROFILE\.pm2\dump.pm2"
if (Test-Path $dump) {
  Get-Content $dump -Raw | Select-String -Pattern 'cron_restart|cron|interval' -AllMatches |
    ForEach-Object { $_.Matches } | ForEach-Object { $_.Value } |
    Select-Object -Unique | Out-File $out -Append -Encoding utf8
} else {
  "dump.pm2 not found at $dump" | Out-File $out -Append -Encoding utf8
}
