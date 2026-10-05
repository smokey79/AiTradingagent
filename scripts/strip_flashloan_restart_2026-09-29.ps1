# strip_flashloan_restart_2026-09-29.ps1
# Moves side=FLASHLOAN (impossible cross-chain simulated) records out of this run's ledger into the archive,
# then restarts ONLY trading-orchestrator so the rebuilt arb engine loads. Nothing is deleted.
$root = 'F:\aitradingagent'
$ledger = "$root\data\trade_ledger.json"
$arch = "$root\runs\2026-09-29_200gbp\archive\flashloan_records_removed_2026-09-29.jsonl"
$utf8 = New-Object System.Text.UTF8Encoding($false)
Set-Location $root
pm2 stop trading-orchestrator | Out-Null
$all = @(Get-Content $ledger | Where-Object { $_.Trim() })
$fl = @($all | Where-Object { $_ -match '"side":"FLASHLOAN"' })
$keep = @($all | Where-Object { $_ -notmatch '"side":"FLASHLOAN"' })
if ($fl.Count) { [System.IO.File]::AppendAllLines($arch, [string[]]$fl, $utf8) }
[System.IO.File]::WriteAllLines($ledger, [string[]]$keep, $utf8)
"moved $($fl.Count) FLASHLOAN records to archive; $($keep.Count) records kept"
pm2 start trading-orchestrator --update-env | Out-Null
"orchestrator restarted $(Get-Date -Format HH:mm:ss)"
