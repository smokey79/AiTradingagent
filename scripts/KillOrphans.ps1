$names = @('risk-gate','trading-data','telegram-listener','dashboard','tradingkit-analyst','trading-orchestrator','python-debate','hermes-analyst','arb-scanner','mt5-feed','freqtrade-bridge')
$tracked = @()
foreach ($a in $names) {
    $p = (pm2 pid $a 2>$null | Select-Object -First 1)
    if ($p -match '^\d+$') { $tracked += [int]$p }
}
Write-Host "TRACKED: $($tracked -join ',')"
$candidates = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'ProcessContainerFork' }
foreach ($c in $candidates) {
    if ($tracked -notcontains $c.ProcessId) {
        Write-Host "KILLING ORPHAN PID=$($c.ProcessId) Created=$($c.CreationDate)"
        Stop-Process -Id $c.ProcessId -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "KEEPING TRACKED PID=$($c.ProcessId)"
    }
}
Write-Host "DONE"
