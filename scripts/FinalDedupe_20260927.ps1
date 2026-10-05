$apps = @('arb-scanner','hermes-analyst','mt5-feed','python-debate','trading-orchestrator')
$trackedPids = @{}
foreach ($app in $apps) {
  $p = (pm2 pid $app 2>$null | Select-Object -First 1)
  if ($p -match '^\d+$') { $trackedPids[$app] = [int]$p }
}
Write-Output "PM2-tracked pids:"
$trackedPids.GetEnumerator() | ForEach-Object { Write-Output "  $($_.Key) = $($_.Value)" }

$scriptMap = @{
  'arb-scanner'          = 'arbitrage_scanner.py'
  'hermes-analyst'       = 'hermes_analyst.py'
  'mt5-feed'             = 'mt5_market_feed.py'
  'python-debate'        = 'debate_runner.py'
}

Write-Output "`nDuplicates found (not the tracked pid):"
foreach ($app in $scriptMap.Keys) {
  $pattern = $scriptMap[$app]
  $matches = Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape($pattern) }
  foreach ($m in $matches) {
    if ($m.ProcessId -ne $trackedPids[$app]) {
      Write-Output "  KILLING $app duplicate pid $($m.ProcessId) (tracked pid is $($trackedPids[$app]))"
      Stop-Process -Id $m.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}
