$pm2AppNames = @('risk-gate','trading-data','telegram-listener','dashboard','tradingkit-analyst','trading-orchestrator','python-debate','hermes-analyst','arb-scanner','mt5-feed','freqtrade-bridge')
$trackedPids = @()
foreach ($app in $pm2AppNames) {
    $p = (pm2 pid $app 2>$null | Select-Object -First 1)
    if ($p -match '^\d+$') { $trackedPids += [int]$p }
}
Write-Host "TRACKED PIDS: $($trackedPids -join ',')"

$pm2Daemon = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'pm2\\lib\\Daemon\.js' } | Select-Object -First 1
if ($pm2Daemon) {
    Write-Host "DAEMON PID: $($pm2Daemon.ProcessId)"
    $children = Get-CimInstance Win32_Process -Filter "Name='node.exe' AND ParentProcessId=$($pm2Daemon.ProcessId)"
    foreach ($c in $children) {
        $tracked = $trackedPids -contains $c.ProcessId
        Write-Host "PID=$($c.ProcessId) Created=$($c.CreationDate) Tracked=$tracked"
    }
} else {
    Write-Host "NO DAEMON FOUND -- listing ALL node.exe instead"
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
        $tracked = $trackedPids -contains $_.ProcessId
        Write-Host "PID=$($_.ProcessId) Created=$($_.CreationDate) Tracked=$tracked ParentPID=$($_.ParentProcessId)"
    }
}
