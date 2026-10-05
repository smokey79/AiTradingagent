# demo_health_2026-10-03.ps1 -- READ-ONLY health view of the demo process set: status + the last lines of each app's logs.
param([int]$Tail = 6)
pm2 status --no-color
$logDir = Join-Path $env:USERPROFILE '.pm2\logs'
foreach ($n in 'trading-orchestrator','dashboard','freqtrade-bridge','bigdata-analyst','telegram-listener') {
  foreach ($kind in 'error','out') {
    $f = Join-Path $logDir "$n-$kind.log"
    if (Test-Path $f) {
      $lines = Get-Content $f -Tail $Tail -ErrorAction SilentlyContinue | ForEach-Object { ($_ -replace '\x1b\[[0-9;]*m','') } | Where-Object { $_.Trim() }
      if ($lines) { "`n--- $n ($kind) last $Tail"; $lines | ForEach-Object { $x = $_; if ($x.Length -gt 190) { $x = $x.Substring(0,190) }; "  " + $x } }
    }
  }
}
